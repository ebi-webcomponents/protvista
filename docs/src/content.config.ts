import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// Starlight content collection (Astro 5 content-layer API). If you are on an
// older Astro/Starlight, this becomes:
//   import { defineCollection } from 'astro:content';
//   import { docsSchema } from '@astrojs/starlight/schema';
//   export const collections = { docs: defineCollection({ schema: docsSchema() }) };
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
