/**
 * Merge upstream EcoLogits data into local data.
 * Upstream wins for any key it has; local-only entries are kept (retained),
 * so models dropped upstream keep working for pi users.
 */

export interface Model {
	provider: string;
	name: string;
	[k: string]: unknown;
}
export interface Alias {
	provider: string;
	name: string;
	alias: string;
	[k: string]: unknown;
}
export interface Mix {
	name: string;
	[k: string]: any;
}
export interface ModelsFile {
	aliases: Alias[];
	models: Model[];
}
export interface MixesFile {
	electricity_mixes: Mix[];
}
export interface MergeLists {
	added: string[];
	changed: string[];
	retained: string[];
}

function mergeBy<T>(local: T[], upstream: T[], key: (x: T) => string): { data: T[] } & MergeLists {
	const localByKey = new Map(local.map((x) => [key(x), x]));
	const upstreamKeys = new Set(upstream.map(key));
	const added: string[] = [];
	const changed: string[] = [];
	for (const u of upstream) {
		const l = localByKey.get(key(u));
		if (!l) added.push(key(u));
		else if (JSON.stringify(l) !== JSON.stringify(u)) changed.push(key(u));
	}
	const kept = local.filter((l) => !upstreamKeys.has(key(l))).sort((a, b) => key(a).localeCompare(key(b)));
	return {
		data: [...upstream, ...kept],
		added: added.sort(),
		changed: changed.sort(),
		retained: kept.map(key),
	};
}

const modelKey = (m: { provider: string; name: string }) => `${m.provider}/${m.name}`;

export function mergeModels(local: ModelsFile, upstream: ModelsFile): { data: ModelsFile } & MergeLists {
	const models = mergeBy(local.models, upstream.models, modelKey);
	const names = new Set(models.data.map(modelKey));
	const upstreamAliases = new Set(upstream.aliases.map(modelKey));
	const keptAliases = local.aliases
		.filter((a) => !upstreamAliases.has(modelKey(a)) && names.has(`${a.provider}/${a.alias}`))
		.sort((a, b) => modelKey(a).localeCompare(modelKey(b)));
	return {
		data: { ...upstream, aliases: [...upstream.aliases, ...keptAliases], models: models.data },
		added: models.added,
		changed: models.changed,
		retained: models.retained,
	};
}

export function mergeMixes(local: MixesFile, upstream: MixesFile): { data: MixesFile } & MergeLists {
	const r = mergeBy(local.electricity_mixes, upstream.electricity_mixes, (m) => m.name);
	return { data: { ...upstream, electricity_mixes: r.data }, added: r.added, changed: r.changed, retained: r.retained };
}
