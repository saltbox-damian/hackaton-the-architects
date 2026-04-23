import { tool } from 'ai';
import { z } from 'zod';
import { API_VERSION, SalesforceApiError, getJson, soql } from '../../salesforce/client';
import { getAgentSession, updateAgentSession } from '../context';

const orgSchema = z
  .enum(['source', 'target'])
  .describe('Which connected org to query. "source" is the org content is migrated from; "target" is where it will land.');

export const listCmsChannels = tool({
  description:
    'List all ManagedContentChannel records (Id, Name) in the selected org. Use this first to discover channelIds before comparing content across orgs.',
  inputSchema: z.object({
    org: orgSchema,
    limit: z.number().int().min(1).max(200).default(100),
  }),
  execute: async ({ org, limit }) => {
    const session = getAgentSession(org);
    const query = `SELECT Id, Name FROM ManagedContentChannel ORDER BY Name ASC LIMIT ${limit}`;
    const result = await soql<{ Id: string; Name: string }>(session, query);
    updateAgentSession(org, result.session);
    return {
      org,
      records: result.records,
      totalSize: result.totalSize,
    };
  },
});

type RawContent = {
  managedContentId?: string;
  contentKey?: string;
  title?: string;
  urlName?: string;
  language?: string;
  publishedDate?: string;
  publishDate?: string;
  contentType?: { fullyQualifiedName?: string };
  resourceUrl?: string;
  unauthenticatedUrl?: string;
};

type NormalizedContent = {
  managedContentId: string | null;
  contentKey: string | null;
  title: string | null;
  urlName: string | null;
  language: string | null;
  publishedDate: string | null;
  contentType: string | null;
  resourceUrl: string | null;
  unauthenticatedUrl: string | null;
};

function normalizeContents(raw: RawContent[] = []): NormalizedContent[] {
  return raw.map((c) => ({
    managedContentId: c.managedContentId ?? null,
    contentKey: c.contentKey ?? null,
    title: c.title ?? null,
    urlName: c.urlName ?? null,
    language: c.language ?? null,
    publishedDate: c.publishedDate ?? c.publishDate ?? null,
    contentType: c.contentType?.fullyQualifiedName ?? null,
    resourceUrl: c.resourceUrl ?? null,
    unauthenticatedUrl: c.unauthenticatedUrl ?? null,
  }));
}

async function fetchChannelContents(
  org: 'source' | 'target',
  channelId: string,
  managedContentType: string | undefined,
  page: number,
  pageSize: number,
) {
  const session = getAgentSession(org);
  const path = `/services/data/${API_VERSION}/connect/cms/delivery/channels/${encodeURIComponent(
    channelId,
  )}/contents`;
  console.log(`[agent:${org}] GET contents`, {
    instanceUrl: session.instanceUrl,
    username: session.username ?? null,
    path,
    managedContentType,
    page,
    pageSize,
  });
  try {
    const { data, session: next } = await getJson<{
      contents?: RawContent[];
      channelInfo?: { name?: string; domainUrl?: string };
      nextPageUrl?: string | null;
    }>(session, path, { managedContentType, page, pageSize });
    updateAgentSession(org, next);
    const items = normalizeContents(data.contents ?? []);
    console.log(`[agent:${org}] GET contents OK`, {
      channelName: data.channelInfo?.name ?? null,
      itemsCount: items.length,
      nextPageUrl: data.nextPageUrl ?? null,
    });
    return {
      channelName: data.channelInfo?.name ?? null,
      items,
      nextPageUrl: data.nextPageUrl ?? null,
    };
  } catch (err) {
    console.error(`[agent:${org}] GET contents FAILED`, {
      channelId,
      path,
      message: (err as Error).message,
      errors: err instanceof SalesforceApiError ? err.errors : undefined,
    });
    throw err;
  }
}

export const getChannelPublishedContent = tool({
  description:
    'Fetch published CMS content for a channel from one org via the Connect REST API (/connect/cms/delivery/channels/{channelId}/contents). Use this to inspect what content a single channel has.',
  inputSchema: z.object({
    org: orgSchema,
    channelId: z.string().min(15).describe('ManagedContentChannel Id.'),
    managedContentType: z
      .string()
      .optional()
      .describe('CMS content type developer name (e.g. sfdc_cms__document). Omit for all types.'),
    page: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(100).default(50),
  }),
  execute: async ({ org, channelId, managedContentType, page, pageSize }) => {
    const result = await fetchChannelContents(org, channelId, managedContentType, page, pageSize);
    return {
      org,
      channelId,
      channelName: result.channelName,
      managedContentType: managedContentType ?? null,
      page,
      pageSize,
      total: result.items.length,
      items: result.items,
      nextPageUrl: result.nextPageUrl,
    };
  },
});

export const compareChannelContent = tool({
  description:
    'Compare published CMS content between the source and target orgs for a given pair of channels. Returns items missing in target (present in source but not target), items only in target, and items in both (matched by contentKey). Use this to answer "what content is missing in target?" for a specific channel.',
  inputSchema: z.object({
    sourceChannelId: z.string().min(15),
    targetChannelId: z.string().min(15),
    managedContentType: z.string().optional(),
    pageSize: z.number().int().min(1).max(100).default(100),
  }),
  execute: async ({ sourceChannelId, targetChannelId, managedContentType, pageSize }) => {
    const [src, tgt] = await Promise.all([
      fetchChannelContents('source', sourceChannelId, managedContentType, 0, pageSize),
      fetchChannelContents('target', targetChannelId, managedContentType, 0, pageSize),
    ]);
    const srcByKey = new Map(src.items.map((i) => [i.contentKey ?? '', i]));
    const tgtByKey = new Map(tgt.items.map((i) => [i.contentKey ?? '', i]));
    const missingInTarget = src.items.filter((i) => i.contentKey && !tgtByKey.has(i.contentKey));
    const onlyInTarget = tgt.items.filter((i) => i.contentKey && !srcByKey.has(i.contentKey));
    const inBoth = src.items.filter((i) => i.contentKey && tgtByKey.has(i.contentKey));
    return {
      source: {
        channelId: sourceChannelId,
        channelName: src.channelName,
        total: src.items.length,
      },
      target: {
        channelId: targetChannelId,
        channelName: tgt.channelName,
        total: tgt.items.length,
      },
      missingInTarget: missingInTarget.map(({ contentKey, title, contentType, urlName }) => ({
        contentKey,
        title,
        contentType,
        urlName,
      })),
      onlyInTarget: onlyInTarget.map(({ contentKey, title, contentType, urlName }) => ({
        contentKey,
        title,
        contentType,
        urlName,
      })),
      inBothCount: inBoth.length,
    };
  },
});

export const compareChannelsByName = tool({
  description:
    'List channels in both orgs and bucket them by name: channels present in both, only in source, only in target. Use this to see which channels exist in the source org but are missing in target, as a first step before comparing content inside matched channels.',
  inputSchema: z.object({}),
  execute: async () => {
    const sourceSession = getAgentSession('source');
    const targetSession = getAgentSession('target');
    const q = `SELECT Id, Name FROM ManagedContentChannel ORDER BY Name ASC LIMIT 200`;
    const [srcR, tgtR] = await Promise.all([
      soql<{ Id: string; Name: string }>(sourceSession, q),
      soql<{ Id: string; Name: string }>(targetSession, q),
    ]);
    updateAgentSession('source', srcR.session);
    updateAgentSession('target', tgtR.session);
    const tgtByName = new Map(tgtR.records.map((r) => [r.Name.toLowerCase(), r]));
    const srcByName = new Map(srcR.records.map((r) => [r.Name.toLowerCase(), r]));
    const inBoth: Array<{ name: string; sourceId: string; targetId: string }> = [];
    const onlyInSource: Array<{ name: string; sourceId: string }> = [];
    const onlyInTarget: Array<{ name: string; targetId: string }> = [];
    for (const s of srcR.records) {
      const t = tgtByName.get(s.Name.toLowerCase());
      if (t) inBoth.push({ name: s.Name, sourceId: s.Id, targetId: t.Id });
      else onlyInSource.push({ name: s.Name, sourceId: s.Id });
    }
    for (const t of tgtR.records) {
      if (!srcByName.has(t.Name.toLowerCase())) {
        onlyInTarget.push({ name: t.Name, targetId: t.Id });
      }
    }
    return { inBoth, onlyInSource, onlyInTarget };
  },
});

export const salesforceTools = {
  listCmsChannels,
  getChannelPublishedContent,
  compareChannelContent,
  compareChannelsByName,
};
