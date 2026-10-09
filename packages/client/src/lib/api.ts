import type { TreeNodeJson } from '@owlbt/shared';

/** Reads the response; non-2xx responses throw an Error carrying the server's text message. */
async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = (await response.text()).trim();
    throw new Error(text || `Request failed with status ${response.status}`);
  }
  return response;
}

function treeUrl(resource: string, treePath: string): string {
  return `/api/${resource}?path=${encodeURIComponent(treePath)}`;
}

/** Raw text of the project file (owl-bt.json) that applies to the tree. */
export async function fetchProject(treePath: string): Promise<string> {
  const response = await request(treeUrl('project', treePath));
  return response.text();
}

export async function fetchTree(treePath: string): Promise<TreeNodeJson> {
  const response = await request(treeUrl('tree', treePath));
  return (await response.json()) as TreeNodeJson;
}

export async function saveTree(treePath: string, json: TreeNodeJson): Promise<void> {
  await request(treeUrl('tree', treePath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });
}
