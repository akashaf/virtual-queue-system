import type { TestProject } from "vitest/node";
import { readLocalSupabase, type LocalSupabase } from "../local-supabase";

declare module "vitest" {
  export interface ProvidedContext {
    supabase: LocalSupabase;
  }
}

export type { LocalSupabase };

export default function setup(project: TestProject) {
  project.provide("supabase", readLocalSupabase());
}
