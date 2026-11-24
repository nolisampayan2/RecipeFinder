// Inactive Admin image-selection foundation. This module does not upload or save files.
export const ADMIN_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ADMIN_IMAGE_MAX_DIMENSION = 4096;
const USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORMATS = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

const MESSAGES = Object.freeze({
  empty: 'Choose a nonempty image.',
  size: 'Choose an image no larger than 5 MiB.',
  format: 'Choose a JPEG, PNG, or WebP image with a matching file type.',
  content: 'The selected file is not a supported image.',
  decode: 'The selected image could not be opened.',
  dimensions: 'Choose an image no larger than 4096 by 4096 pixels.',
  unavailable: 'Local image preview is unavailable.',
});

let nextGroupId = 0;

function signatureMatches(bytes, mimeType) {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  return bytes.length >= 12 && [82, 73, 70, 70].every((byte, index) => bytes[index] === byte)
    && [87, 69, 66, 80].every((byte, index) => bytes[index + 8] === byte);
}

function invalid(code) {
  return Object.freeze({ ok: false, code });
}

export async function inspectAdminImageFile(file) {
  try {
    if (!file || typeof file !== 'object' || Array.isArray(file)) return invalid('format');
    const { name, size, type } = file;
    if (typeof name !== 'string' || !name || /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(name)) return invalid('format');
    if (!Number.isSafeInteger(size) || size < 0) return invalid('format');
    if (size === 0) return invalid('empty');
    if (size > ADMIN_IMAGE_MAX_BYTES) return invalid('size');
    const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
    const mimeType = FORMATS[extension];
    if (!mimeType || type !== mimeType || typeof file.slice !== 'function') return invalid('format');
    const header = await file.slice(0, 12)?.arrayBuffer?.();
    if (!(header instanceof ArrayBuffer) || !signatureMatches(new Uint8Array(header), mimeType)) return invalid('content');
    return Object.freeze({ ok: true, mimeType });
  } catch {
    return invalid('content');
  }
}

export function decodeAdminImageInBrowser(objectUrl, signal) {
  return new Promise((resolve, reject) => {
    if (typeof globalThis.Image !== 'function' || signal?.aborted) {
      reject(new TypeError('Image decoding unavailable.'));
      return;
    }
    const image = new globalThis.Image();
    const clean = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener?.('abort', onAbort);
    };
    const onAbort = () => {
      clean();
      image.src = '';
      reject(new TypeError('Image decoding canceled.'));
    };
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      clean();
      resolve(dimensions);
    };
    image.onerror = () => {
      clean();
      reject(new TypeError('Image decoding failed.'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else image.src = objectUrl;
  });
}

function appendText(documentLike, parent, tag, value, className = '') {
  const node = documentLike.createElement(tag);
  node.className = className;
  node.textContent = value;
  parent.append(node);
  return node;
}

export function createAdminImageSelection({
  documentLike = globalThis.document,
  urlApi = globalThis.URL,
  decodeImage = decodeAdminImageInBrowser,
} = {}) {
  if (typeof documentLike?.createElement !== 'function' || typeof urlApi?.createObjectURL !== 'function'
    || typeof urlApi?.revokeObjectURL !== 'function' || typeof decodeImage !== 'function') {
    throw new TypeError('Image selection requires browser capabilities.');
  }

  const root = documentLike.createElement('fieldset');
  root.className = 'admin-form-section admin-image-selection';
  appendText(documentLike, root, 'legend', 'Recipe image');
  appendText(documentLike, root, 'p', 'Select a JPEG, PNG, or WebP image, up to 5 MiB and 4096 × 4096 pixels.', 'admin-section-help');
  const groupName = `admin-image-mode-${++nextGroupId}`;
  const modeGroup = documentLike.createElement('div');
  modeGroup.className = 'admin-image-selection-modes';
  const modeRadio = (label, value, checked) => {
    const wrapper = documentLike.createElement('label');
    const radio = documentLike.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = value;
    radio.checked = checked;
    wrapper.append(radio, documentLike.createTextNode(label));
    modeGroup.append(wrapper);
    return radio;
  };
  const manualMode = modeRadio('Image URL', 'url', true);
  const fileMode = modeRadio('Choose image file', 'file', false);
  root.append(modeGroup);

  const manualPanel = documentLike.createElement('label');
  manualPanel.className = 'admin-field';
  appendText(documentLike, manualPanel, 'span', 'Main image URL');
  const manualUrl = documentLike.createElement('input');
  manualUrl.type = 'url';
  manualPanel.append(manualUrl);
  root.append(manualPanel);

  const filePanel = documentLike.createElement('div');
  filePanel.className = 'admin-image-selection-file';
  filePanel.hidden = true;
  const fileLabel = documentLike.createElement('label');
  fileLabel.className = 'admin-field';
  appendText(documentLike, fileLabel, 'span', 'Choose image');
  const fileInput = documentLike.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
  fileLabel.append(fileInput);
  filePanel.append(fileLabel);
  const filename = appendText(documentLike, filePanel, 'p', '', 'admin-image-selection-name');
  const preview = documentLike.createElement('img');
  preview.className = 'admin-image-selection-preview';
  preview.alt = 'Selected recipe image preview';
  preview.hidden = true;
  filePanel.append(preview);
  const actions = documentLike.createElement('div');
  actions.className = 'admin-image-selection-actions';
  const change = appendText(documentLike, actions, 'button', 'Change image', 'admin-secondary-button');
  change.type = 'button';
  change.disabled = true;
  const remove = appendText(documentLike, actions, 'button', 'Remove selection', 'admin-secondary-button');
  remove.type = 'button';
  remove.disabled = true;
  filePanel.append(actions);
  root.append(filePanel);
  const status = appendText(documentLike, root, 'p', '', 'admin-image-selection-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');

  let authorized = false;
  let authorizedUserId = null;
  let destroyed = false;
  let generation = 0;
  let controller = null;
  let objectUrl = null;
  let selectedFile = null;
  let selectedMimeType = null;

  const announce = (message = '', error = false) => {
    status.textContent = message;
    status.classList.toggle('is-error', error);
  };
  const release = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    if (objectUrl !== null) {
      try { urlApi.revokeObjectURL(objectUrl); } catch { /* A preview cannot outlive its selection. */ }
      objectUrl = null;
    }
    preview.removeAttribute('src');
    preview.hidden = true;
    selectedFile = null;
    selectedMimeType = null;
    filename.textContent = '';
    fileInput.value = '';
    change.disabled = true;
    remove.disabled = true;
  };
  const current = (token, userId) => !destroyed && authorized && authorizedUserId === userId
    && token === generation && fileMode.checked;
  const selectFile = async (file) => {
    if (destroyed || !authorized || !fileMode.checked) return false;
    release();
    const token = generation;
    const userId = authorizedUserId;
    announce('Checking selected image.');
    const inspected = await inspectAdminImageFile(file);
    if (!current(token, userId)) return false;
    if (!inspected.ok) {
      announce(MESSAGES[inspected.code], true);
      return false;
    }
    let candidateUrl;
    let installed = false;
    try {
      candidateUrl = urlApi.createObjectURL(file);
      if (typeof candidateUrl !== 'string' || !candidateUrl.startsWith('blob:')) throw new TypeError('Invalid preview URL.');
      objectUrl = candidateUrl;
      installed = true;
      controller = new AbortController();
      const dimensions = await decodeImage(candidateUrl, controller.signal);
      if (!current(token, userId)) return false;
      if (!Number.isSafeInteger(dimensions?.width) || !Number.isSafeInteger(dimensions?.height)
        || dimensions.width <= 0 || dimensions.height <= 0) throw new TypeError('Invalid dimensions.');
      if (dimensions.width > ADMIN_IMAGE_MAX_DIMENSION || dimensions.height > ADMIN_IMAGE_MAX_DIMENSION) {
        release();
        announce(MESSAGES.dimensions, true);
        return false;
      }
      selectedFile = file;
      selectedMimeType = inspected.mimeType;
      filename.textContent = file.name;
      preview.src = candidateUrl;
      preview.hidden = false;
      change.disabled = false;
      remove.disabled = false;
      announce('Local preview ready. The image has not been uploaded or saved.');
      return true;
    } catch {
      if (current(token, userId)) {
        release();
        announce(MESSAGES.decode, true);
      }
      return false;
    } finally {
      if (!installed && typeof candidateUrl === 'string') {
        try { urlApi.revokeObjectURL(candidateUrl); } catch { /* Ignore invalidated preview cleanup errors. */ }
      }
    }
  };
  const switchMode = (mode) => {
    if (destroyed || !authorized || !['url', 'file'].includes(mode)) return false;
    release();
    manualMode.checked = mode === 'url';
    fileMode.checked = mode === 'file';
    manualPanel.hidden = mode !== 'url';
    filePanel.hidden = mode !== 'file';
    announce(mode === 'file' ? 'Choose an image to preview locally. It will not be uploaded or saved.' : 'Enter a main image URL.');
    return true;
  };
  const onFileChange = () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void selectFile(file);
  };
  const onManualMode = () => { if (manualMode.checked) switchMode('url'); };
  const onFileMode = () => { if (fileMode.checked) switchMode('file'); };
  const onChange = () => { if (authorized) announce('Image URL changed.'); };
  const onRemove = () => { if (authorized && fileMode.checked) { release(); announce('Image selection removed.'); } };
  const onChooseAgain = () => { if (authorized && fileMode.checked) fileInput.click(); };
  fileInput.addEventListener('change', onFileChange);
  manualMode.addEventListener('change', onManualMode);
  fileMode.addEventListener('change', onFileMode);
  manualUrl.addEventListener('input', onChange);
  remove.addEventListener('click', onRemove);
  change.addEventListener('click', onChooseAgain);
  const controls = [manualMode, fileMode, manualUrl, fileInput, change, remove];
  for (const control of controls) control.disabled = true;

  return Object.freeze({
    element: root,
    setAuthorization(value, userId = null) {
      if (destroyed) return false;
      // Identity scopes local selection state; it is never proof of server authorization.
      const validIdentity = value === true && typeof userId === 'string' && USER_UUID.test(userId);
      const nextUserId = validIdentity ? userId.toLowerCase() : null;
      if (nextUserId !== authorizedUserId) {
        release();
        manualUrl.value = '';
        manualMode.checked = true;
        fileMode.checked = false;
        manualPanel.hidden = false;
        filePanel.hidden = true;
        announce();
      }
      authorizedUserId = nextUserId;
      authorized = nextUserId !== null;
      for (const control of [manualMode, fileMode, manualUrl, fileInput]) control.disabled = !authorized;
      change.disabled = !authorized || !selectedFile;
      remove.disabled = !authorized || !selectedFile;
      return value !== true || validIdentity;
    },
    selectFile,
    switchMode,
    removeSelection: onRemove,
    cancel() { if (destroyed) return false; release(); manualUrl.value = ''; announce(); return true; },
    getSelection() {
      if (destroyed || !authorized) return null;
      if (fileMode.checked) return selectedFile ? Object.freeze({ mode: 'file', file: selectedFile, mimeType: selectedMimeType }) : null;
      return Object.freeze({ mode: 'url', imageUrl: manualUrl.value });
    },
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      authorized = false;
      authorizedUserId = null;
      release();
      manualUrl.value = '';
      announce();
      fileInput.removeEventListener('change', onFileChange);
      manualMode.removeEventListener('change', onManualMode);
      fileMode.removeEventListener('change', onFileMode);
      manualUrl.removeEventListener('input', onChange);
      remove.removeEventListener('click', onRemove);
      change.removeEventListener('click', onChooseAgain);
      root.replaceChildren();
      return true;
    },
  });
}
