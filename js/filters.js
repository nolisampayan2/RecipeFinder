export function filterRecipes(recipes, query, filter) {
  const normalizedQuery = query.toLowerCase();
  return recipes.filter((recipe) => {
    const matchesFilter = !filter || recipe.category === filter || recipe.cuisine === filter;
    const searchableText = [recipe.name, recipe.category, recipe.cuisine, recipe.description, ...recipe.ingredients.flat()].join(' ').toLowerCase();
    return matchesFilter && (!normalizedQuery || searchableText.includes(normalizedQuery));
  });
}
