// Types follow the Stremio addon protocol:
// https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api

export type ExtraProp = {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
};

export type ManifestCatalog = {
  type: string;
  id: string;
  name?: string;
  extra?: ExtraProp[];
  // Legacy fields
  genres?: string[];
  extraSupported?: string[];
  extraRequired?: string[];
};

export type ManifestResource =
  | string
  | { name: string; types?: string[]; idPrefixes?: string[] };

export type Manifest = {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  background?: string;
  contactEmail?: string;
  types: string[];
  resources: ManifestResource[];
  catalogs: ManifestCatalog[];
  addonCatalogs?: ManifestCatalog[];
  idPrefixes?: string[] | null;
  behaviorHints?: {
    adult?: boolean;
    p2p?: boolean;
    configurable?: boolean;
    configurationRequired?: boolean;
    [k: string]: unknown;
  };
};

export type AddonFlags = { official?: boolean; protected?: boolean };

export type AddonDescriptor = {
  transportUrl: string;
  transportName?: string;
  manifest: Manifest;
  flags?: AddonFlags;
};

export type PosterShape = 'poster' | 'landscape' | 'square';

export type Link = { name: string; category: string; url: string };

export type Video = {
  id: string;
  title?: string;
  name?: string;
  released?: string;
  thumbnail?: string;
  overview?: string;
  description?: string;
  season?: number;
  episode?: number;
  number?: number;
  streams?: Stream[];
  trailers?: Stream[];
};

export type MetaPreview = {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: PosterShape;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
  genre?: string[];
  year?: string;
  runtime?: string;
  links?: Link[];
  trailerStreams?: { title?: string; ytId: string }[];
  behaviorHints?: { defaultVideoId?: string | null; [k: string]: unknown };
};

export type MetaDetail = MetaPreview & {
  released?: string;
  cast?: string[];
  director?: string[] | null;
  writer?: string[] | null;
  country?: string;
  awards?: string;
  language?: string;
  website?: string;
  status?: string;
  videos?: Video[];
};

export type Stream = {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  sources?: string[];
  subtitles?: Subtitle[];
  /** MoviePlex-only: transport URL of the addon this stream came from (for picking the next episode). */
  movieplexAddon?: string;
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
    countryWhitelist?: string[];
    proxyHeaders?: { request?: Record<string, string>; response?: Record<string, string> };
    videoHash?: string;
    videoSize?: number;
    filename?: string;
    [k: string]: unknown;
  };
};

export type Subtitle = { id?: string; url: string; lang: string };

export type CatalogRef = {
  addon: AddonDescriptor;
  catalog: ManifestCatalog;
};
