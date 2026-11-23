-- Additive, conflict-failing data preparation only. No grants or RLS changes.
-- Static contract tests are not PostgreSQL runtime proof.
begin;
lock table public.recipes in share row exclusive mode;

do $migration$
declare
  expected jsonb := $recipes$[
  {
    "id": "creamy-garlic-pasta",
    "name": "Creamy Garlic Pasta",
    "description": "Silky pasta tossed with roasted garlic, herbs, and parmesan.",
    "category_slug": "pasta",
    "category": "Pasta",
    "cuisine_slug": "italian",
    "cuisine": "Italian",
    "image_url": "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=82",
    "fallback_image_url": null,
    "tutorial_url": "https://www.youtube.com/results?search_query=creamy+garlic+pasta+recipe",
    "ingredients": [
      {
        "name": "Fettuccine",
        "measurement": "300 g"
      },
      {
        "name": "Garlic",
        "measurement": "5 cloves"
      },
      {
        "name": "Cooking cream",
        "measurement": "1 cup"
      },
      {
        "name": "Parmesan",
        "measurement": "¾ cup"
      },
      {
        "name": "Parsley",
        "measurement": "2 tbsp"
      }
    ],
    "instructions": "Boil the pasta until al dente.\nGently cook minced garlic in olive oil. Add cream and simmer for 3 minutes.\nToss in pasta and parmesan, season, then finish with parsley.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "lemon-chicken",
    "name": "Grilled Lemon Chicken",
    "description": "Juicy grilled chicken with bright lemon, garlic, and garden herbs.",
    "category_slug": "chicken",
    "category": "Chicken",
    "cuisine_slug": "american",
    "cuisine": "American",
    "image_url": "https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=900&q=82",
    "fallback_image_url": null,
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Chicken breasts",
        "measurement": "4"
      },
      {
        "name": "Lemon",
        "measurement": "2"
      },
      {
        "name": "Garlic",
        "measurement": "3 cloves"
      },
      {
        "name": "Olive oil",
        "measurement": "3 tbsp"
      },
      {
        "name": "Fresh thyme",
        "measurement": "1 tbsp"
      }
    ],
    "instructions": "Whisk lemon juice, garlic, oil, thyme, salt, and pepper.\nMarinate chicken for 30 minutes.\nGrill for 6–7 minutes per side until cooked through, then rest before slicing.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "beef-stew",
    "name": "Hearty Beef Stew",
    "description": "A slow-simmered classic with tender beef and root vegetables.",
    "category_slug": "beef",
    "category": "Beef",
    "cuisine_slug": "british",
    "cuisine": "British",
    "image_url": "assets/beef-stew.png",
    "fallback_image_url": "assets/beef-stew.png",
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Beef chuck",
        "measurement": "700 g"
      },
      {
        "name": "Potatoes",
        "measurement": "3"
      },
      {
        "name": "Carrots",
        "measurement": "3"
      },
      {
        "name": "Beef stock",
        "measurement": "4 cups"
      },
      {
        "name": "Tomato paste",
        "measurement": "2 tbsp"
      }
    ],
    "instructions": "Brown the beef in batches.\nSoften vegetables, stir in tomato paste, then return the beef.\nAdd stock and simmer covered for 90 minutes until tender.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "fish-tacos",
    "name": "Crispy Fish Tacos",
    "description": "Golden fish, crunchy slaw, avocado, and a creamy lime sauce.",
    "category_slug": "seafood",
    "category": "Seafood",
    "cuisine_slug": "mexican",
    "cuisine": "Mexican",
    "image_url": "https://images.unsplash.com/photo-1552332386-f8dd00dc2f85?auto=format&fit=crop&w=900&q=82",
    "fallback_image_url": null,
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "White fish",
        "measurement": "450 g"
      },
      {
        "name": "Corn tortillas",
        "measurement": "8"
      },
      {
        "name": "Cabbage",
        "measurement": "2 cups"
      },
      {
        "name": "Lime",
        "measurement": "2"
      },
      {
        "name": "Avocado",
        "measurement": "1"
      }
    ],
    "instructions": "Season and pan-sear the fish until golden.\nMix cabbage with lime and a pinch of salt.\nWarm tortillas and fill with fish, slaw, avocado, and sauce.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "chocolate-cake",
    "name": "Chocolate Cloud Cake",
    "description": "A rich, tender chocolate cake with a glossy ganache finish.",
    "category_slug": "dessert",
    "category": "Dessert",
    "cuisine_slug": "french",
    "cuisine": "French",
    "image_url": "https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=82",
    "fallback_image_url": null,
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Dark chocolate",
        "measurement": "200 g"
      },
      {
        "name": "Flour",
        "measurement": "1¼ cups"
      },
      {
        "name": "Eggs",
        "measurement": "3"
      },
      {
        "name": "Butter",
        "measurement": "120 g"
      },
      {
        "name": "Sugar",
        "measurement": "¾ cup"
      }
    ],
    "instructions": "Melt chocolate and butter together.\nWhisk eggs with sugar, then fold in the chocolate and flour.\nBake at 175°C for 28–32 minutes and cool before serving.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "garden-salad",
    "name": "Garden Harvest Salad",
    "description": "Crisp vegetables, creamy feta, herbs, and lemon vinaigrette.",
    "category_slug": "vegetarian",
    "category": "Vegetarian",
    "cuisine_slug": "mediterranean",
    "cuisine": "Mediterranean",
    "image_url": "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=900&q=82",
    "fallback_image_url": null,
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Mixed greens",
        "measurement": "4 cups"
      },
      {
        "name": "Cucumber",
        "measurement": "1"
      },
      {
        "name": "Cherry tomatoes",
        "measurement": "1 cup"
      },
      {
        "name": "Feta",
        "measurement": "100 g"
      },
      {
        "name": "Lemon",
        "measurement": "1"
      }
    ],
    "instructions": "Wash and dry the vegetables.\nWhisk lemon juice with olive oil, salt, and pepper.\nToss everything together just before serving.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "tomato-soup",
    "name": "Roasted Tomato Soup",
    "description": "Velvety roasted tomato soup finished with basil and cream.",
    "category_slug": "soup",
    "category": "Soup",
    "cuisine_slug": "italian",
    "cuisine": "Italian",
    "image_url": "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=900&q=82",
    "fallback_image_url": null,
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Tomatoes",
        "measurement": "1 kg"
      },
      {
        "name": "Onion",
        "measurement": "1"
      },
      {
        "name": "Garlic",
        "measurement": "1 bulb"
      },
      {
        "name": "Vegetable stock",
        "measurement": "2 cups"
      },
      {
        "name": "Basil",
        "measurement": "1 handful"
      }
    ],
    "instructions": "Roast tomatoes, onion, and garlic until caramelized.\nBlend with warm stock until smooth.\nSimmer for 10 minutes, season, and garnish with basil.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "vegetable-curry",
    "name": "Coconut Vegetable Curry",
    "description": "Colorful vegetables simmered in a fragrant coconut curry sauce.",
    "category_slug": "vegetarian",
    "category": "Vegetarian",
    "cuisine_slug": "indian",
    "cuisine": "Indian",
    "image_url": "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=900&q=82",
    "fallback_image_url": null,
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Mixed vegetables",
        "measurement": "5 cups"
      },
      {
        "name": "Coconut milk",
        "measurement": "400 ml"
      },
      {
        "name": "Curry powder",
        "measurement": "2 tbsp"
      },
      {
        "name": "Chickpeas",
        "measurement": "1 can"
      },
      {
        "name": "Cilantro",
        "measurement": "½ cup"
      }
    ],
    "instructions": "Toast curry powder in a little oil.\nAdd vegetables, chickpeas, and coconut milk.\nSimmer until tender and finish with cilantro.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "pancakes",
    "name": "Berry Cloud Pancakes",
    "description": "Fluffy breakfast pancakes topped with berries and maple syrup.",
    "category_slug": "breakfast",
    "category": "Breakfast",
    "cuisine_slug": "american",
    "cuisine": "American",
    "image_url": "https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=900&q=82",
    "fallback_image_url": null,
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Flour",
        "measurement": "1½ cups"
      },
      {
        "name": "Milk",
        "measurement": "1¼ cups"
      },
      {
        "name": "Egg",
        "measurement": "1"
      },
      {
        "name": "Baking powder",
        "measurement": "2 tsp"
      },
      {
        "name": "Mixed berries",
        "measurement": "1 cup"
      }
    ],
    "instructions": "Whisk dry ingredients, then fold in milk and egg.\nCook ladlefuls on a lightly buttered skillet until golden.\nServe warm with berries and maple syrup.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "salmon-bowl",
    "name": "Sesame Salmon Bowl",
    "description": "Glazed salmon with rice, greens, avocado, and sesame.",
    "category_slug": "seafood",
    "category": "Seafood",
    "cuisine_slug": "japanese",
    "cuisine": "Japanese",
    "image_url": "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=900&q=82",
    "fallback_image_url": null,
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Salmon fillets",
        "measurement": "2"
      },
      {
        "name": "Cooked rice",
        "measurement": "2 cups"
      },
      {
        "name": "Soy sauce",
        "measurement": "2 tbsp"
      },
      {
        "name": "Avocado",
        "measurement": "1"
      },
      {
        "name": "Sesame seeds",
        "measurement": "1 tbsp"
      }
    ],
    "instructions": "Brush salmon with soy glaze and roast at 200°C for 10–12 minutes.\nDivide rice and vegetables between bowls.\nTop with salmon and sesame seeds.",
    "status": "published",
    "source_type": "seed",
    "external_provider": null,
    "external_id": null,
    "published_at": "2026-10-27T00:00:00Z"
  },
  {
    "id": "external:fictional-offline:990001",
    "name": "Aurora Garden Couscous",
    "description": "A fictional offline couscous preview with roasted vegetables and herbs.",
    "category_slug": "vegetarian",
    "category": "Vegetarian",
    "cuisine_slug": "mediterranean",
    "cuisine": "Mediterranean",
    "image_url": "assets/recipefinder-favicon.svg",
    "fallback_image_url": "assets/recipefinder-favicon.svg",
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Couscous",
        "measurement": "1 cup"
      },
      {
        "name": "Roasted vegetables",
        "measurement": "2 cups"
      },
      {
        "name": "Fresh herbs",
        "measurement": "1 handful"
      }
    ],
    "instructions": "Prepare the couscous, fold in the vegetables, and finish with herbs.",
    "status": "published",
    "source_type": "external",
    "external_provider": "fictional-offline",
    "external_id": "990001",
    "published_at": "2026-11-23T00:00:00Z"
  },
  {
    "id": "external:fictional-offline:990002",
    "name": "Midnight Citrus Noodles",
    "description": "A fictional offline noodle preview brightened with citrus and sesame.",
    "category_slug": "pasta",
    "category": "Pasta",
    "cuisine_slug": "japanese",
    "cuisine": "Japanese",
    "image_url": "assets/recipefinder-favicon.svg",
    "fallback_image_url": "assets/recipefinder-favicon.svg",
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Noodles",
        "measurement": "250 g"
      },
      {
        "name": "Citrus juice",
        "measurement": "3 tbsp"
      },
      {
        "name": "Sesame",
        "measurement": "1 tbsp"
      }
    ],
    "instructions": "Cook the noodles, toss with citrus dressing, and sprinkle with sesame.",
    "status": "published",
    "source_type": "external",
    "external_provider": "fictional-offline",
    "external_id": "990002",
    "published_at": "2026-11-23T00:00:00Z"
  },
  {
    "id": "external:fictional-offline:990003",
    "name": "Ember Lime Chicken",
    "description": "A fictional offline chicken preview with charred lime and mild spices.",
    "category_slug": "chicken",
    "category": "Chicken",
    "cuisine_slug": "mexican",
    "cuisine": "Mexican",
    "image_url": "assets/recipefinder-favicon.svg",
    "fallback_image_url": "assets/recipefinder-favicon.svg",
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Chicken",
        "measurement": "500 g"
      },
      {
        "name": "Lime",
        "measurement": "2"
      },
      {
        "name": "Mild spices",
        "measurement": "2 tsp"
      }
    ],
    "instructions": "Season the chicken, grill until cooked, and finish with lime.",
    "status": "published",
    "source_type": "external",
    "external_provider": "fictional-offline",
    "external_id": "990003",
    "published_at": "2026-11-23T00:00:00Z"
  },
  {
    "id": "external:fictional-offline:990004",
    "name": "Cocoa Pear Tart",
    "description": "A fictional offline tart preview pairing cocoa pastry with ripe pear.",
    "category_slug": "dessert",
    "category": "Dessert",
    "cuisine_slug": "french",
    "cuisine": "French",
    "image_url": "assets/recipefinder-favicon.svg",
    "fallback_image_url": "assets/recipefinder-favicon.svg",
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Pear",
        "measurement": "2"
      },
      {
        "name": "Cocoa pastry",
        "measurement": "1 shell"
      },
      {
        "name": "Vanilla",
        "measurement": "1 tsp"
      }
    ],
    "instructions": "Arrange pears in the pastry shell and bake until tender.",
    "status": "published",
    "source_type": "external",
    "external_provider": "fictional-offline",
    "external_id": "990004",
    "published_at": "2026-11-23T00:00:00Z"
  },
  {
    "id": "external:fictional-offline:990005",
    "name": "Coastal Sesame Rice Bowl",
    "description": "A fictional offline seafood bowl preview with rice and sesame greens.",
    "category_slug": "seafood",
    "category": "Seafood",
    "cuisine_slug": "american",
    "cuisine": "American",
    "image_url": "assets/recipefinder-favicon.svg",
    "fallback_image_url": "assets/recipefinder-favicon.svg",
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "White fish",
        "measurement": "300 g"
      },
      {
        "name": "Rice",
        "measurement": "2 cups"
      },
      {
        "name": "Sesame greens",
        "measurement": "1 cup"
      }
    ],
    "instructions": "Cook the fish, arrange over rice, and add sesame greens.",
    "status": "published",
    "source_type": "external",
    "external_provider": "fictional-offline",
    "external_id": "990005",
    "published_at": "2026-11-23T00:00:00Z"
  },
  {
    "id": "external:fictional-offline:990006",
    "name": "Sunrise Tomato Toast",
    "description": "A fictional offline breakfast preview with tomatoes and crisp toast.",
    "category_slug": "breakfast",
    "category": "Breakfast",
    "cuisine_slug": "italian",
    "cuisine": "Italian",
    "image_url": "assets/recipefinder-favicon.svg",
    "fallback_image_url": "assets/recipefinder-favicon.svg",
    "tutorial_url": null,
    "ingredients": [
      {
        "name": "Bread",
        "measurement": "4 slices"
      },
      {
        "name": "Tomatoes",
        "measurement": "3"
      },
      {
        "name": "Basil",
        "measurement": "1 handful"
      }
    ],
    "instructions": "Toast the bread and top with seasoned tomatoes and basil.",
    "status": "published",
    "source_type": "external",
    "external_provider": "fictional-offline",
    "external_id": "990006",
    "published_at": "2026-11-23T00:00:00Z"
  }
]$recipes$::jsonb;
  target jsonb;
  category_row public.recipe_categories%rowtype;
  cuisine_row public.cuisines%rowtype;
  existing_row public.recipes%rowtype;
  conflicting_id text;
begin
  if pg_catalog.jsonb_array_length(expected) <> 16 then
    raise exception 'Recipe inventory count is invalid';
  end if;

  for target in select value from pg_catalog.jsonb_array_elements(expected) loop
    select * into category_row
    from public.recipe_categories
    where slug = target->>'category_slug'
    for share;
    if not found or category_row.is_active is distinct from true
      or category_row.name is distinct from target->>'category' then
      raise exception 'Required active category is missing or incompatible for %', target->>'id';
    end if;

    select * into cuisine_row
    from public.cuisines
    where slug = target->>'cuisine_slug'
    for share;
    if not found or cuisine_row.is_active is distinct from true
      or cuisine_row.name is distinct from target->>'cuisine' then
      raise exception 'Required active cuisine is missing or incompatible for %', target->>'id';
    end if;

    if target->>'source_type' = 'external' then
      conflicting_id := null;
      select id into conflicting_id
      from public.recipes
      where external_provider = target->>'external_provider'
        and external_id = target->>'external_id'
      for update;
      if found and conflicting_id is distinct from target->>'id' then
        raise exception 'Conflicting fictional external identity for %', target->>'id';
      end if;
    end if;

    insert into public.recipes (
      id, name, description, category_id, cuisine_id, image_url,
      fallback_image_url, tutorial_url, ingredients, instructions,
      status, source_type, external_provider, external_id, created_by, published_at
    )
    select
      target->>'id', target->>'name', target->>'description', category_row.id, cuisine_row.id,
      target->>'image_url', target->>'fallback_image_url', target->>'tutorial_url',
      target->'ingredients', target->>'instructions', 'published', target->>'source_type',
      target->>'external_provider', target->>'external_id', null,
      (target->>'published_at')::timestamptz
    where not exists (
      select 1 from public.recipes where id = target->>'id'
    );

    select * into existing_row from public.recipes where id = target->>'id' for update;
    if not found
      or existing_row.name is distinct from target->>'name'
      or existing_row.description is distinct from target->>'description'
      or existing_row.category_id is distinct from category_row.id
      or existing_row.cuisine_id is distinct from cuisine_row.id
      or existing_row.image_url is distinct from target->>'image_url'
      or existing_row.fallback_image_url is distinct from target->>'fallback_image_url'
      or existing_row.tutorial_url is distinct from target->>'tutorial_url'
      or existing_row.ingredients is distinct from target->'ingredients'
      or existing_row.instructions is distinct from target->>'instructions'
      or existing_row.status is distinct from 'published'
      or existing_row.source_type is distinct from target->>'source_type'
      or existing_row.external_provider is distinct from target->>'external_provider'
      or existing_row.external_id is distinct from target->>'external_id'
      or existing_row.created_by is not null
      or existing_row.published_at is distinct from (target->>'published_at')::timestamptz
    then
      raise exception 'Existing recipe conflicts with intended data for %', target->>'id';
    end if;
  end loop;
end;
$migration$;

commit;
