import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AssistantConfig } from "@rag-generator/shared";
import { sourcesPath } from "./paths.js";

const quickActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().min(1),
  prompt: z.string().min(1),
  href: z.string().url().optional(),
});

export const assistantConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  assistantName: z.string().min(1),
  contact: z.object({
    name: z.string().min(1),
    url: z.string().url(),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
  }),
  copy: z.object({
    headline: z.string().min(1),
    intro: z.string().min(1),
    disclaimer: z.string().min(1),
    refusal: z.string().min(1),
    placeholder: z.string().min(1).optional(),
  }),
  prompt: z.object({
    role: z.string().min(1),
    neverDo: z.array(z.string().min(1)).min(1),
    declineOffer: z.string().min(1),
    guidance: z.array(z.string().min(1)).optional(),
  }),
  crawl: z.object({
    seeds: z.array(z.string().url()).min(1),
    allowPrefixes: z.array(z.string().url()).min(1),
    denyPatterns: z.array(z.string()).optional(),
    documentHosts: z.array(z.string()).optional(),
  }),
  quickActions: z.array(quickActionSchema),
  suggestedQuestions: z.array(z.string()),
});

export function loadAssistantConfig(file: string = sourcesPath): AssistantConfig {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return assistantConfigSchema.parse(raw) as AssistantConfig;
}
