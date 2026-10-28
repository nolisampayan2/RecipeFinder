const EXTERNAL_ID = /^external:([a-z0-9-]+):(\d+)$/;
const KNOWN_PROVIDERS = new Set(['fictional-offline', 'themealdb']);

export class ExternalSourceRegistryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExternalSourceRegistryError';
    this.code = code;
  }
}

export function parseExternalSourceId(value) {
  const match = typeof value === 'string' ? EXTERNAL_ID.exec(value) : null;
  if (!match || !KNOWN_PROVIDERS.has(match[1])) {
    throw new ExternalSourceRegistryError('INVALID_ID', 'A valid external recipe ID is required.');
  }
  return Object.freeze({ id: value, provider: match[1], externalId: match[2] });
}

function requireController(controller) {
  const methods = ['getDetails', 'invalidateDetails', 'getCachedDetails'];
  if (!controller || typeof controller !== 'object' || methods.some((method) => typeof controller[method] !== 'function')) {
    throw new ExternalSourceRegistryError('INVALID_CONTROLLER', 'A compatible external recipe controller is required.');
  }
  return controller;
}

export function createExternalSourceRegistry({ controllers = {} } = {}) {
  if (!controllers || typeof controllers !== 'object' || Array.isArray(controllers)) {
    throw new ExternalSourceRegistryError('INVALID_REGISTRY', 'External controllers must be provided by provider name.');
  }
  const registered = new Map();
  Object.entries(controllers).forEach(([provider, controller]) => {
    if (!KNOWN_PROVIDERS.has(provider)) {
      throw new ExternalSourceRegistryError('UNKNOWN_PROVIDER', 'The external recipe provider is not recognized.');
    }
    registered.set(provider, requireController(controller));
  });

  const controllerFor = (id) => {
    const identity = parseExternalSourceId(id);
    const controller = registered.get(identity.provider);
    if (!controller) {
      throw new ExternalSourceRegistryError('UNREGISTERED_PROVIDER', 'The external recipe provider is unavailable.');
    }
    return { controller, identity };
  };

  return Object.freeze({
    getDetails(id) {
      const { controller, identity } = controllerFor(id);
      return controller.getDetails(identity.id);
    },
    getCachedDetails(id) {
      const { controller, identity } = controllerFor(id);
      return controller.getCachedDetails(identity.id);
    },
    invalidateDetails(id) {
      if (id === undefined) {
        registered.forEach((controller) => controller.invalidateDetails());
        return;
      }
      const { controller, identity } = controllerFor(id);
      controller.invalidateDetails(identity.id);
    },
  });
}
