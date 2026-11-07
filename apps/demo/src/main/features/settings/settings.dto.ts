import { z } from "zod";

export const localeSchema = z.enum(["fr", "en"]);
export const settingsSchema = z.object({ locale: localeSchema });
export type Settings = z.infer<typeof settingsSchema>;
