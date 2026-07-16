import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { NegativeKeyword, SearchTerm, TopicKeyword } from "@/lib/types";

/**
 * The three editable lists share the same CRUD shape. Rather than
 * copy-paste three near-identical hook files, we factor them into a
 * generic `makeListHooks` and export three narrow bundles for each
 * list. Keeps invalidation keys aligned with the URL segments so a
 * `POST /search-terms` invalidates `queryKey ["search-terms"]`.
 */

type ListConfig<Item, CreateBody, UpdateBody> = {
  key: string;
  path: string;
  responseKey: string;
  itemKey: string;
  extract: (raw: unknown) => Item[];
  extractOne: (raw: unknown) => Item;
  createBody: (input: CreateBody) => object;
  updateBody: (input: UpdateBody) => object;
};

function makeListHooks<Item, CreateBody, UpdateBody>(cfg: ListConfig<Item, CreateBody, UpdateBody>) {
  const useList = () =>
    useQuery<Item[]>({
      queryKey: [cfg.key],
      queryFn: async () => cfg.extract(await api<unknown>(cfg.path)),
    });

  const useCreate = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async (input: CreateBody) =>
        cfg.extractOne(await api<unknown>(cfg.path, { method: "POST", body: cfg.createBody(input) })),
      onSuccess: () => qc.invalidateQueries({ queryKey: [cfg.key] }),
    });
  };

  const useUpdate = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: async (input: { id: string; patch: UpdateBody }) =>
        cfg.extractOne(
          await api<unknown>(`${cfg.path}/${input.id}`, {
            method: "PUT",
            body: cfg.updateBody(input.patch),
          }),
        ),
      onSuccess: () => qc.invalidateQueries({ queryKey: [cfg.key] }),
    });
  };

  const useDelete = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => api<undefined>(`${cfg.path}/${id}`, { method: "DELETE" }),
      onSuccess: () => qc.invalidateQueries({ queryKey: [cfg.key] }),
    });
  };

  return { useList, useCreate, useUpdate, useDelete };
}

// -----------------------------------------------------------------
// Search terms
// -----------------------------------------------------------------
export const searchTermsHooks = makeListHooks<
  SearchTerm,
  { term: string },
  { term?: string; active?: boolean }
>({
  key: "search-terms",
  path: "/search-terms",
  responseKey: "search_terms",
  itemKey: "search_term",
  extract: (raw) => (raw as { search_terms: SearchTerm[] }).search_terms,
  extractOne: (raw) => (raw as { search_term: SearchTerm }).search_term,
  createBody: (i) => i,
  updateBody: (i) => i,
});

// -----------------------------------------------------------------
// Negative keywords
// -----------------------------------------------------------------
export const negativeKeywordsHooks = makeListHooks<
  NegativeKeyword,
  { keyword: string },
  { keyword?: string; active?: boolean }
>({
  key: "negative-keywords",
  path: "/negative-keywords",
  responseKey: "negative_keywords",
  itemKey: "negative_keyword",
  extract: (raw) => (raw as { negative_keywords: NegativeKeyword[] }).negative_keywords,
  extractOne: (raw) => (raw as { negative_keyword: NegativeKeyword }).negative_keyword,
  createBody: (i) => i,
  updateBody: (i) => i,
});

// -----------------------------------------------------------------
// Topic keywords
// -----------------------------------------------------------------
export const topicKeywordsHooks = makeListHooks<
  TopicKeyword,
  { keyword: string; topic_label: string },
  { keyword?: string; topic_label?: string; active?: boolean }
>({
  key: "topic-keywords",
  path: "/topic-keywords",
  responseKey: "topic_keywords",
  itemKey: "topic_keyword",
  extract: (raw) => (raw as { topic_keywords: TopicKeyword[] }).topic_keywords,
  extractOne: (raw) => (raw as { topic_keyword: TopicKeyword }).topic_keyword,
  createBody: (i) => i,
  updateBody: (i) => i,
});
