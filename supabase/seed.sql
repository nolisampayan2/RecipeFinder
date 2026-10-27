-- RecipeFinder deterministic reference and recipe seed data.
-- Apply only after 202610270001_recipefinder_foundation.sql has succeeded.

begin;

insert into public.recipe_categories (slug, name, emoji, sort_order, is_active)
values
  ('chicken', 'Chicken', '🍗', 10, true),
  ('beef', 'Beef', '🥩', 20, true),
  ('seafood', 'Seafood', '🐟', 30, true),
  ('pasta', 'Pasta', '🍝', 40, true),
  ('vegetarian', 'Vegetarian', '🥗', 50, true),
  ('dessert', 'Dessert', '🍰', 60, true),
  ('breakfast', 'Breakfast', '🍳', 70, true),
  ('soup', 'Soup', '🥣', 80, true)
on conflict (slug) do update set
  name = excluded.name,
  emoji = excluded.emoji,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.cuisines (slug, name, flag_emoji, sort_order, is_active)
values
  ('italian', 'Italian', '🇮🇹', 10, true),
  ('american', 'American', '🇺🇸', 20, true),
  ('british', 'British', '🇬🇧', 30, true),
  ('mexican', 'Mexican', '🇲🇽', 40, true),
  ('japanese', 'Japanese', '🇯🇵', 50, true),
  ('indian', 'Indian', '🇮🇳', 60, true),
  ('french', 'French', null, 70, true),
  ('mediterranean', 'Mediterranean', null, 80, true)
on conflict (slug) do update set
  name = excluded.name,
  flag_emoji = excluded.flag_emoji,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.recipes (
  id, name, description, category_id, cuisine_id, image_url,
  fallback_image_url, tutorial_url, ingredients, instructions,
  status, source_type, external_provider, external_id, published_at
)
values
  (
    'creamy-garlic-pasta',
    'Creamy Garlic Pasta',
    'Silky pasta tossed with roasted garlic, herbs, and parmesan.',
    (select id from public.recipe_categories where slug = 'pasta'),
    (select id from public.cuisines where slug = 'italian'),
    'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=82',
    null,
    'https://www.youtube.com/results?search_query=creamy+garlic+pasta+recipe',
    $json$[{"name":"Fettuccine","measurement":"300 g"},{"name":"Garlic","measurement":"5 cloves"},{"name":"Cooking cream","measurement":"1 cup"},{"name":"Parmesan","measurement":"¾ cup"},{"name":"Parsley","measurement":"2 tbsp"}]$json$::jsonb,
    $instructions$Boil the pasta until al dente.
Gently cook minced garlic in olive oil. Add cream and simmer for 3 minutes.
Toss in pasta and parmesan, season, then finish with parsley.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  ),
  (
    'lemon-chicken',
    'Grilled Lemon Chicken',
    'Juicy grilled chicken with bright lemon, garlic, and garden herbs.',
    (select id from public.recipe_categories where slug = 'chicken'),
    (select id from public.cuisines where slug = 'american'),
    'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=900&q=82',
    null, null,
    $json$[{"name":"Chicken breasts","measurement":"4"},{"name":"Lemon","measurement":"2"},{"name":"Garlic","measurement":"3 cloves"},{"name":"Olive oil","measurement":"3 tbsp"},{"name":"Fresh thyme","measurement":"1 tbsp"}]$json$::jsonb,
    $instructions$Whisk lemon juice, garlic, oil, thyme, salt, and pepper.
Marinate chicken for 30 minutes.
Grill for 6–7 minutes per side until cooked through, then rest before slicing.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  ),
  (
    'beef-stew',
    'Hearty Beef Stew',
    'A slow-simmered classic with tender beef and root vegetables.',
    (select id from public.recipe_categories where slug = 'beef'),
    (select id from public.cuisines where slug = 'british'),
    'assets/beef-stew.png',
    'assets/beef-stew.png',
    null,
    $json$[{"name":"Beef chuck","measurement":"700 g"},{"name":"Potatoes","measurement":"3"},{"name":"Carrots","measurement":"3"},{"name":"Beef stock","measurement":"4 cups"},{"name":"Tomato paste","measurement":"2 tbsp"}]$json$::jsonb,
    $instructions$Brown the beef in batches.
Soften vegetables, stir in tomato paste, then return the beef.
Add stock and simmer covered for 90 minutes until tender.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  ),
  (
    'fish-tacos',
    'Crispy Fish Tacos',
    'Golden fish, crunchy slaw, avocado, and a creamy lime sauce.',
    (select id from public.recipe_categories where slug = 'seafood'),
    (select id from public.cuisines where slug = 'mexican'),
    'https://images.unsplash.com/photo-1552332386-f8dd00dc2f85?auto=format&fit=crop&w=900&q=82',
    null, null,
    $json$[{"name":"White fish","measurement":"450 g"},{"name":"Corn tortillas","measurement":"8"},{"name":"Cabbage","measurement":"2 cups"},{"name":"Lime","measurement":"2"},{"name":"Avocado","measurement":"1"}]$json$::jsonb,
    $instructions$Season and pan-sear the fish until golden.
Mix cabbage with lime and a pinch of salt.
Warm tortillas and fill with fish, slaw, avocado, and sauce.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  ),
  (
    'chocolate-cake',
    'Chocolate Cloud Cake',
    'A rich, tender chocolate cake with a glossy ganache finish.',
    (select id from public.recipe_categories where slug = 'dessert'),
    (select id from public.cuisines where slug = 'french'),
    'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=82',
    null, null,
    $json$[{"name":"Dark chocolate","measurement":"200 g"},{"name":"Flour","measurement":"1¼ cups"},{"name":"Eggs","measurement":"3"},{"name":"Butter","measurement":"120 g"},{"name":"Sugar","measurement":"¾ cup"}]$json$::jsonb,
    $instructions$Melt chocolate and butter together.
Whisk eggs with sugar, then fold in the chocolate and flour.
Bake at 175°C for 28–32 minutes and cool before serving.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  ),
  (
    'garden-salad',
    'Garden Harvest Salad',
    'Crisp vegetables, creamy feta, herbs, and lemon vinaigrette.',
    (select id from public.recipe_categories where slug = 'vegetarian'),
    (select id from public.cuisines where slug = 'mediterranean'),
    'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=900&q=82',
    null, null,
    $json$[{"name":"Mixed greens","measurement":"4 cups"},{"name":"Cucumber","measurement":"1"},{"name":"Cherry tomatoes","measurement":"1 cup"},{"name":"Feta","measurement":"100 g"},{"name":"Lemon","measurement":"1"}]$json$::jsonb,
    $instructions$Wash and dry the vegetables.
Whisk lemon juice with olive oil, salt, and pepper.
Toss everything together just before serving.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  ),
  (
    'tomato-soup',
    'Roasted Tomato Soup',
    'Velvety roasted tomato soup finished with basil and cream.',
    (select id from public.recipe_categories where slug = 'soup'),
    (select id from public.cuisines where slug = 'italian'),
    'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=82',
    null, null,
    $json$[{"name":"Tomatoes","measurement":"1 kg"},{"name":"Onion","measurement":"1"},{"name":"Garlic","measurement":"1 bulb"},{"name":"Vegetable stock","measurement":"2 cups"},{"name":"Basil","measurement":"1 handful"}]$json$::jsonb,
    $instructions$Roast tomatoes, onion, and garlic until caramelized.
Blend with warm stock until smooth.
Simmer for 10 minutes, season, and garnish with basil.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  ),
  (
    'vegetable-curry',
    'Coconut Vegetable Curry',
    'Colorful vegetables simmered in a fragrant coconut curry sauce.',
    (select id from public.recipe_categories where slug = 'vegetarian'),
    (select id from public.cuisines where slug = 'indian'),
    'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=900&q=82',
    null, null,
    $json$[{"name":"Mixed vegetables","measurement":"5 cups"},{"name":"Coconut milk","measurement":"400 ml"},{"name":"Curry powder","measurement":"2 tbsp"},{"name":"Chickpeas","measurement":"1 can"},{"name":"Cilantro","measurement":"½ cup"}]$json$::jsonb,
    $instructions$Toast curry powder in a little oil.
Add vegetables, chickpeas, and coconut milk.
Simmer until tender and finish with cilantro.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  ),
  (
    'pancakes',
    'Berry Cloud Pancakes',
    'Fluffy breakfast pancakes topped with berries and maple syrup.',
    (select id from public.recipe_categories where slug = 'breakfast'),
    (select id from public.cuisines where slug = 'american'),
    'https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=900&q=82',
    null, null,
    $json$[{"name":"Flour","measurement":"1½ cups"},{"name":"Milk","measurement":"1¼ cups"},{"name":"Egg","measurement":"1"},{"name":"Baking powder","measurement":"2 tsp"},{"name":"Mixed berries","measurement":"1 cup"}]$json$::jsonb,
    $instructions$Whisk dry ingredients, then fold in milk and egg.
Cook ladlefuls on a lightly buttered skillet until golden.
Serve warm with berries and maple syrup.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  ),
  (
    'salmon-bowl',
    'Sesame Salmon Bowl',
    'Glazed salmon with rice, greens, avocado, and sesame.',
    (select id from public.recipe_categories where slug = 'seafood'),
    (select id from public.cuisines where slug = 'japanese'),
    'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=900&q=82',
    null, null,
    $json$[{"name":"Salmon fillets","measurement":"2"},{"name":"Cooked rice","measurement":"2 cups"},{"name":"Soy sauce","measurement":"2 tbsp"},{"name":"Avocado","measurement":"1"},{"name":"Sesame seeds","measurement":"1 tbsp"}]$json$::jsonb,
    $instructions$Brush salmon with soy glaze and roast at 200°C for 10–12 minutes.
Divide rice and vegetables between bowls.
Top with salmon and sesame seeds.$instructions$,
    'published', 'seed', null, null, '2026-10-27T00:00:00Z'
  )
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category_id = excluded.category_id,
  cuisine_id = excluded.cuisine_id,
  image_url = excluded.image_url,
  fallback_image_url = excluded.fallback_image_url,
  tutorial_url = excluded.tutorial_url,
  ingredients = excluded.ingredients,
  instructions = excluded.instructions,
  status = excluded.status,
  source_type = excluded.source_type,
  external_provider = excluded.external_provider,
  external_id = excluded.external_id,
  published_at = excluded.published_at;

commit;
