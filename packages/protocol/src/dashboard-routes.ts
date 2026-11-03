import { z } from 'zod';

export const dashboardViewSchema = z.enum([
  'overview',
  'workspaces',
  'agents',
  'models',
  'settings',
]);
export type DashboardView = z.infer<typeof dashboardViewSchema>;

/** URL representation only: this schema does not prove an observed session exists. */
export const dashboardSessionPathSchema = z
  .string()
  .max(1820)
  .regex(/^\/overview\/sessions\/[^/]+$/)
  .refine((path) => {
    try {
      const segment = path.slice('/overview/sessions/'.length);
      const id = decodeURIComponent(segment);
      return (
        id.length > 0 &&
        id.length <= 200 &&
        id !== '.' &&
        id !== '..' &&
        !/[\\/%]/u.test(id) &&
        !Array.from(id).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || (code >= 127 && code <= 159);
        }) &&
        encodeURIComponent(id) === segment
      );
    } catch {
      return false;
    }
  });

export const dashboardPathSchema = z
  .string()
  .refine(
    (path) =>
      path === '/' ||
      dashboardViewSchema.options.some((view) => path === `/${view}`) ||
      dashboardSessionPathSchema.safeParse(path).success,
  );
