const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function getCarouselBoundaries(scrollLeft, clientWidth, scrollWidth) {
  return {
    atStart: scrollLeft <= 1,
    atEnd: scrollLeft + clientWidth >= scrollWidth - 1,
  };
}

export function initializeCategoryCarousel() {
  const row = document.querySelector('#category-row');
  const previousButton = document.querySelector('#category-prev');
  const nextButton = document.querySelector('#category-next');
  if (!row || !previousButton || !nextButton) return;

  const behavior = () => matchMedia(REDUCED_MOTION_QUERY).matches ? 'auto' : 'smooth';
  const scrollAmount = () => Math.max(row.clientWidth * 0.75, 120);

  const updateControls = () => {
    if (row.classList.contains('show-all')) {
      previousButton.disabled = true;
      nextButton.disabled = true;
      return;
    }
    const { atStart, atEnd } = getCarouselBoundaries(
      row.scrollLeft,
      row.clientWidth,
      row.scrollWidth,
    );
    previousButton.disabled = atStart;
    nextButton.disabled = atEnd;
  };

  const move = (direction) => {
    row.scrollBy({ left: scrollAmount() * direction, behavior: behavior() });
  };

  previousButton.addEventListener('click', () => move(-1));
  nextButton.addEventListener('click', () => move(1));
  row.addEventListener('scroll', updateControls, { passive: true });
  window.addEventListener('resize', updateControls);

  row.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      row.scrollTo({ left: 0, behavior: behavior() });
    } else if (event.key === 'End') {
      event.preventDefault();
      row.scrollTo({ left: row.scrollWidth, behavior: behavior() });
    }
  });

  requestAnimationFrame(updateControls);
}

export function toggleCategoriesExpansion() {
  const row = document.querySelector('#category-row');
  const section = document.querySelector('#categories');
  const viewAllButton = section?.querySelector('[data-view-all="categories"]');
  if (!row || !section || !viewAllButton) return;

  const expanded = !row.classList.contains('show-all');
  row.classList.toggle('show-all', expanded);
  section.classList.toggle('categories-expanded', expanded);
  row.scrollLeft = 0;
  viewAllButton.textContent = expanded ? 'Show less ↑' : 'View all →';
  viewAllButton.setAttribute('aria-expanded', String(expanded));

  const previousButton = document.querySelector('#category-prev');
  const nextButton = document.querySelector('#category-next');
  if (previousButton) previousButton.disabled = true;
  if (nextButton) nextButton.disabled = expanded || row.clientWidth >= row.scrollWidth - 1;
}
