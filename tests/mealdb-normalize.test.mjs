import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeAreas,
  normalizeCategories,
  normalizeFullMeal,
  normalizeMealCollection,
  normalizeMealSummary,
} from '../js/mealdb-normalize.js';

const hostileName = '<img src=x onerror="fictional()">';
const fullFixture = {
  idMeal: '90001',
  strMeal: hostileName,
  strCategory: 'Fictional Stew',
  strArea: 'Test Kitchen',
  strMealThumb: 'https://images.example.test/meal.jpg',
  strInstructions: '<script>fictional()</script> Stir safely.',
  strYoutube: 'https://www.youtube.com/watch?v=fictional',
};
for (let index = 1; index <= 20; index += 1) {
  fullFixture[`strIngredient${index}`] = `Ingredient ${index}`;
  fullFixture[`strMeasure${index}`] = index === 20 ? '' : `${index} units`;
}
const snapshot = structuredClone(fullFixture);
const full = normalizeFullMeal(fullFixture);
assert.equal(full.id, 'external:themealdb:90001');
assert.equal(full.source, 'external');
assert.equal(full.externalProvider, 'themealdb');
assert.equal(full.externalId, '90001');
assert.equal(full.detailLevel, 'full');
assert.equal(full.name, hostileName, 'Hostile-looking text must remain plain data');
assert.equal(full.description, '', 'The normalizer must not invent a description');
assert.equal(full.ingredients.length, 20);
assert.deepEqual(full.ingredients[19], ['Ingredient 20', '']);
assert.equal(full.instructions, '<script>fictional()</script> Stir safely.');
assert.equal(full.tutorial, 'https://www.youtube.com/watch?v=fictional');
assert.deepEqual(fullFixture, snapshot, 'Normalization must not mutate its fixture input');

const missing = normalizeFullMeal({ idMeal: '90002', strMeal: 'Minimal Fictional Meal' });
assert.equal(missing.category, '');
assert.equal(missing.cuisine, '');
assert.equal(missing.image, '');
assert.equal(missing.description, '');
assert.deepEqual(missing.ingredients, []);
assert.equal(missing.instructions, '');
assert.equal(missing.tutorial, '');

const unsafe = normalizeFullMeal({
  idMeal: '90003',
  strMeal: 'Unsafe URL Fixture',
  strMealThumb: 'javascript:fictional()',
  strYoutube: 'data:text/html,fictional',
});
assert.equal(unsafe.image, '');
assert.equal(unsafe.tutorial, '');

const summary = normalizeMealSummary(
  { idMeal: '90004', strMeal: 'Summary Fixture', strMealThumb: 'https://images.example.test/summary.jpg' },
  { category: 'Fictional Category', cuisine: 'Fictional Area' },
);
assert.equal(summary.detailLevel, 'summary');
assert.equal(summary.category, 'Fictional Category');
assert.equal(summary.cuisine, 'Fictional Area');
assert.deepEqual(summary.ingredients, []);
assert.equal(summary.instructions, '');

assert.deepEqual(
  normalizeMealCollection([
    { idMeal: '90005', strMeal: 'First' },
    { idMeal: '90006', strMeal: 'Second' },
  ], normalizeMealSummary, { category: 'Fixture' }).map((meal) => meal.id),
  ['external:themealdb:90005', 'external:themealdb:90006'],
);
assert.throws(
  () => normalizeMealCollection([
    { idMeal: '90005', strMeal: 'First' },
    { idMeal: '90005', strMeal: 'Duplicate' },
  ]),
  /Duplicate external recipe identity/,
);

const categoriesFixture = [{
  idCategory: '12',
  strCategory: 'Fictional Category',
  strCategoryThumb: 'https://images.example.test/category.png',
  strCategoryDescription: '<b>Plain description data</b>',
}];
const categoriesSnapshot = structuredClone(categoriesFixture);
assert.deepEqual(normalizeCategories(categoriesFixture), [{
  id: 'external:themealdb:category:12',
  source: 'external',
  externalProvider: 'themealdb',
  externalId: '12',
  name: 'Fictional Category',
  image: 'https://images.example.test/category.png',
  description: '<b>Plain description data</b>',
}]);
assert.deepEqual(categoriesFixture, categoriesSnapshot);
assert.throws(() => normalizeCategories([...categoriesFixture, ...categoriesFixture]), /Duplicate external category identity/);

assert.deepEqual(normalizeAreas([{ strArea: 'Fictionland' }, { strArea: 'Test Isles' }]), [
  { name: 'Fictionland' },
  { name: 'Test Isles' },
]);
assert.throws(() => normalizeAreas([{ strArea: 'Fictionland' }, { strArea: 'fictionland' }]), /Duplicate external area/);

for (const operation of [
  () => normalizeFullMeal(null),
  () => normalizeFullMeal({ idMeal: '../1', strMeal: 'Invalid' }),
  () => normalizeFullMeal({ idMeal: '1', strMeal: '' }),
  () => normalizeMealCollection('not-an-array'),
  () => normalizeCategories([{ idCategory: 'x', strCategory: 'Invalid' }]),
  () => normalizeAreas([{ strArea: '\u0000Invalid' }]),
]) assert.throws(operation, TypeError);

const source = await readFile(new URL('../js/mealdb-normalize.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.|window\.|localStorage|sessionStorage/);
assert.doesNotMatch(source, /fetch\s*\(|supabase|signUp|signIn|exchangeCodeForSession/i);

console.log('Offline TheMealDB normalization tests passed with fictional immutable fixtures only.');
