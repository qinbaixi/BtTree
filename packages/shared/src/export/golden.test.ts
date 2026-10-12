import { describe, expect, it } from 'vitest';
import { compileProject } from '../compileProject';
import { nodeFromJson, createIdGen } from '../treeModel';
import type { ProjectFile, TreeNodeJson } from '../types';
import { toCSharp } from './csharp';
import { buildExportModel } from './buildExportModel';
import { toErlang } from './erlang';
import { toGo } from './go';
import { toLua } from './lua';
import { toTypeScript } from './typescript';

/**
 * Reproduces D:\Nemo\server\gameserver\src\config\bt_mon_1000.erl with an owl-bt project.
 * The expected bodies below are the reference body (from the first get_node(1) clause to the end),
 * with two intentional differences:
 *  - decorators emit inverse_check_condition before abort_mode / ignore_check (Erlang maps are unordered
 *    in the reference; the export order is fixed),
 *  - every clause is preceded by a `%% <Type>[ - <label>]` comment line.
 */
const GOLDEN_PROJECT: ProjectFile = {
  nodes: [
    { name: 'Selector', isComposite: true },
    { name: 'Sequence', isComposite: true },
    {
      name: 'Task27',
      export: { subType: 27 },
      properties: [
        { name: 'finish_once', type: 'bool', default: true, exportTo: 'node' },
        { name: 'sight_dist', type: 'number', default: 5000 },
        { name: 'trace_dist', type: 'number', default: 5000 },
      ],
    },
    { name: 'Task2', export: { subType: 2 } },
    { name: 'Task1', export: { subType: 1 } },
    { name: 'Task10', export: { subType: 10 } },
  ],
  decorators: [
    {
      name: 'Decorator21',
      export: { subType: 21 },
      properties: [
        { name: 'abort_mode', type: 'number', default: 0, exportTo: 'node' },
        { name: 'ignore_check', type: 'bool', default: false, exportTo: 'node' },
      ],
    },
    {
      name: 'Decorator24',
      export: { subType: 24 },
      properties: [
        { name: 'abort_mode', type: 'number', default: 0, exportTo: 'node' },
        { name: 'ignore_check', type: 'bool', default: false, exportTo: 'node' },
      ],
    },
  ],
  services: [
    {
      name: 'Service1',
      export: { subType: 1 },
      properties: [
        { name: 'lock_time', type: 'number' },
        { name: 'sight_dist', type: 'number' },
        { name: 'trace_dist', type: 'number' },
      ],
    },
  ],
};

const GOLDEN_TREE: TreeNodeJson = {
  type: 'Selector',
  label: 'Root',
  childNodes: [
    {
      type: 'Task27',
      decorators: [{ type: 'Decorator21' }],
    },
    {
      type: 'Task27',
      decorators: [{ type: 'Decorator24' }],
    },
    {
      type: 'Selector',
      services: [
        {
          type: 'Service1',
          properties: [
            { name: 'lock_time', value: 999999 },
            { name: 'sight_dist', value: 300 },
            { name: 'trace_dist', value: 3000 },
          ],
        },
      ],
      childNodes: [
        {
          type: 'Sequence',
          childNodes: [{ type: 'Task2' }, { type: 'Task1' }],
        },
        { type: 'Task10' },
      ],
    },
  ],
};

const EXPECTED_ERLANG_BODY = `get_node(1) ->
    #{
        node_id => 1,
        type => composite,
        sub_type => selector,
        decorators => [],
        services => [],
        children => [3,5,7]
    };
%% Decorator21
get_node(2) ->
    #{
        node_id => 2,
        type => decorator,
        sub_type => 21,
        inverse_check_condition => false,
        abort_mode => 0,
        ignore_check => false,
        properties => #{
        }
    };
%% Task27
get_node(3) ->
    #{
        node_id => 3,
        type => task,
        sub_type => 27,
        finish_once => true,
        decorators => [2],
        services => [],
        properties => #{
            sight_dist => 5000,
            trace_dist => 5000
        }
    };
%% Decorator24
get_node(4) ->
    #{
        node_id => 4,
        type => decorator,
        sub_type => 24,
        inverse_check_condition => false,
        abort_mode => 0,
        ignore_check => false,
        properties => #{
        }
    };
%% Task27
get_node(5) ->
    #{
        node_id => 5,
        type => task,
        sub_type => 27,
        finish_once => true,
        decorators => [4],
        services => [],
        properties => #{
            sight_dist => 5000,
            trace_dist => 5000
        }
    };
%% Service1
get_node(6) ->
    #{
        node_id => 6,
        type => service,
        sub_type => 1,
        properties => #{
            lock_time => 999999,
            sight_dist => 300,
            trace_dist => 3000
        }
    };
%% Selector
get_node(7) ->
    #{
        node_id => 7,
        type => composite,
        sub_type => selector,
        decorators => [],
        services => [6],
        children => [8,11]
    };
%% Sequence
get_node(8) ->
    #{
        node_id => 8,
        type => composite,
        sub_type => sequence,
        decorators => [],
        services => [],
        children => [9,10]
    };
%% Task2
get_node(9) ->
    #{
        node_id => 9,
        type => task,
        sub_type => 2,
        decorators => [],
        services => [],
        properties => #{
        }
    };
%% Task1
get_node(10) ->
    #{
        node_id => 10,
        type => task,
        sub_type => 1,
        decorators => [],
        services => [],
        properties => #{
        }
    };
%% Task10
get_node(11) ->
    #{
        node_id => 11,
        type => task,
        sub_type => 10,
        decorators => [],
        services => [],
        properties => #{
        }
    };
get_node(_) -> undefined.


get_root_node() -> 1.


`;

const EXPECTED_LUA = `-- Generated by owl-bt from trees/bt_mon_1000.json. Do not edit.
local nodes = {
    -- Selector - Root
    [1] = {
        node_id = 1,
        type = "composite",
        sub_type = "selector",
        decorators = {},
        services = {},
        children = {3, 5, 7},
    },
    -- Decorator21
    [2] = {
        node_id = 2,
        type = "decorator",
        sub_type = 21,
        inverse_check_condition = false,
        abort_mode = 0,
        ignore_check = false,
        properties = {},
    },
    -- Task27
    [3] = {
        node_id = 3,
        type = "task",
        sub_type = 27,
        finish_once = true,
        decorators = {2},
        services = {},
        properties = {
            sight_dist = 5000,
            trace_dist = 5000,
        },
    },
    -- Decorator24
    [4] = {
        node_id = 4,
        type = "decorator",
        sub_type = 24,
        inverse_check_condition = false,
        abort_mode = 0,
        ignore_check = false,
        properties = {},
    },
    -- Task27
    [5] = {
        node_id = 5,
        type = "task",
        sub_type = 27,
        finish_once = true,
        decorators = {4},
        services = {},
        properties = {
            sight_dist = 5000,
            trace_dist = 5000,
        },
    },
    -- Service1
    [6] = {
        node_id = 6,
        type = "service",
        sub_type = 1,
        properties = {
            lock_time = 999999,
            sight_dist = 300,
            trace_dist = 3000,
        },
    },
    -- Selector
    [7] = {
        node_id = 7,
        type = "composite",
        sub_type = "selector",
        decorators = {},
        services = {6},
        children = {8, 11},
    },
    -- Sequence
    [8] = {
        node_id = 8,
        type = "composite",
        sub_type = "sequence",
        decorators = {},
        services = {},
        children = {9, 10},
    },
    -- Task2
    [9] = {
        node_id = 9,
        type = "task",
        sub_type = 2,
        decorators = {},
        services = {},
        properties = {},
    },
    -- Task1
    [10] = {
        node_id = 10,
        type = "task",
        sub_type = 1,
        decorators = {},
        services = {},
        properties = {},
    },
    -- Task10
    [11] = {
        node_id = 11,
        type = "task",
        sub_type = 10,
        decorators = {},
        services = {},
        properties = {},
    },
}

return {
    root = 1,
    nodes = nodes,
    get_node = function(id) return nodes[id] end,
}
`;

const EXPECTED_TS = `// Generated by owl-bt from trees/bt_mon_1000.json. Do not edit.
export interface BtNode {
  node_id: number;
  type: string;
  sub_type: string | number;
  [key: string]: unknown;
}

export const rootId = 1;

export const nodes: Readonly<Record<number, BtNode>> = {
  // Selector - Root
  1: {
    node_id: 1,
    type: 'composite',
    sub_type: 'selector',
    decorators: [],
    services: [],
    children: [3, 5, 7],
  },
  // Decorator21
  2: {
    node_id: 2,
    type: 'decorator',
    sub_type: 21,
    inverse_check_condition: false,
    abort_mode: 0,
    ignore_check: false,
    properties: {},
  },
  // Task27
  3: {
    node_id: 3,
    type: 'task',
    sub_type: 27,
    finish_once: true,
    decorators: [2],
    services: [],
    properties: {
      sight_dist: 5000,
      trace_dist: 5000,
    },
  },
  // Decorator24
  4: {
    node_id: 4,
    type: 'decorator',
    sub_type: 24,
    inverse_check_condition: false,
    abort_mode: 0,
    ignore_check: false,
    properties: {},
  },
  // Task27
  5: {
    node_id: 5,
    type: 'task',
    sub_type: 27,
    finish_once: true,
    decorators: [4],
    services: [],
    properties: {
      sight_dist: 5000,
      trace_dist: 5000,
    },
  },
  // Service1
  6: {
    node_id: 6,
    type: 'service',
    sub_type: 1,
    properties: {
      lock_time: 999999,
      sight_dist: 300,
      trace_dist: 3000,
    },
  },
  // Selector
  7: {
    node_id: 7,
    type: 'composite',
    sub_type: 'selector',
    decorators: [],
    services: [6],
    children: [8, 11],
  },
  // Sequence
  8: {
    node_id: 8,
    type: 'composite',
    sub_type: 'sequence',
    decorators: [],
    services: [],
    children: [9, 10],
  },
  // Task2
  9: {
    node_id: 9,
    type: 'task',
    sub_type: 2,
    decorators: [],
    services: [],
    properties: {},
  },
  // Task1
  10: {
    node_id: 10,
    type: 'task',
    sub_type: 1,
    decorators: [],
    services: [],
    properties: {},
  },
  // Task10
  11: {
    node_id: 11,
    type: 'task',
    sub_type: 10,
    decorators: [],
    services: [],
    properties: {},
  },
};

export function getNode(id: number): BtNode | undefined {
  return nodes[id];
}
`;

const EXPECTED_CS = `// <auto-generated>
// Generated by owl-bt from trees/bt_mon_1000.json. Do not edit.
// </auto-generated>
using System.Collections.Generic;

namespace BehaviorTrees
{
    public static class BtMon1000
    {
        public const int RootId = 1;

        public static readonly Dictionary<int, Dictionary<string, object>> Nodes = new Dictionary<int, Dictionary<string, object>>
        {
            // Selector - Root
            [1] = new Dictionary<string, object>
            {
                ["node_id"] = 1,
                ["type"] = "composite",
                ["sub_type"] = "selector",
                ["decorators"] = new int[] { },
                ["services"] = new int[] { },
                ["children"] = new int[] { 3, 5, 7 },
            },
            // Decorator21
            [2] = new Dictionary<string, object>
            {
                ["node_id"] = 2,
                ["type"] = "decorator",
                ["sub_type"] = 21,
                ["inverse_check_condition"] = false,
                ["abort_mode"] = 0,
                ["ignore_check"] = false,
                ["properties"] = new Dictionary<string, object>(),
            },
            // Task27
            [3] = new Dictionary<string, object>
            {
                ["node_id"] = 3,
                ["type"] = "task",
                ["sub_type"] = 27,
                ["finish_once"] = true,
                ["decorators"] = new int[] { 2 },
                ["services"] = new int[] { },
                ["properties"] = new Dictionary<string, object>
                {
                    ["sight_dist"] = 5000,
                    ["trace_dist"] = 5000,
                },
            },
            // Decorator24
            [4] = new Dictionary<string, object>
            {
                ["node_id"] = 4,
                ["type"] = "decorator",
                ["sub_type"] = 24,
                ["inverse_check_condition"] = false,
                ["abort_mode"] = 0,
                ["ignore_check"] = false,
                ["properties"] = new Dictionary<string, object>(),
            },
            // Task27
            [5] = new Dictionary<string, object>
            {
                ["node_id"] = 5,
                ["type"] = "task",
                ["sub_type"] = 27,
                ["finish_once"] = true,
                ["decorators"] = new int[] { 4 },
                ["services"] = new int[] { },
                ["properties"] = new Dictionary<string, object>
                {
                    ["sight_dist"] = 5000,
                    ["trace_dist"] = 5000,
                },
            },
            // Service1
            [6] = new Dictionary<string, object>
            {
                ["node_id"] = 6,
                ["type"] = "service",
                ["sub_type"] = 1,
                ["properties"] = new Dictionary<string, object>
                {
                    ["lock_time"] = 999999,
                    ["sight_dist"] = 300,
                    ["trace_dist"] = 3000,
                },
            },
            // Selector
            [7] = new Dictionary<string, object>
            {
                ["node_id"] = 7,
                ["type"] = "composite",
                ["sub_type"] = "selector",
                ["decorators"] = new int[] { },
                ["services"] = new int[] { 6 },
                ["children"] = new int[] { 8, 11 },
            },
            // Sequence
            [8] = new Dictionary<string, object>
            {
                ["node_id"] = 8,
                ["type"] = "composite",
                ["sub_type"] = "sequence",
                ["decorators"] = new int[] { },
                ["services"] = new int[] { },
                ["children"] = new int[] { 9, 10 },
            },
            // Task2
            [9] = new Dictionary<string, object>
            {
                ["node_id"] = 9,
                ["type"] = "task",
                ["sub_type"] = 2,
                ["decorators"] = new int[] { },
                ["services"] = new int[] { },
                ["properties"] = new Dictionary<string, object>(),
            },
            // Task1
            [10] = new Dictionary<string, object>
            {
                ["node_id"] = 10,
                ["type"] = "task",
                ["sub_type"] = 1,
                ["decorators"] = new int[] { },
                ["services"] = new int[] { },
                ["properties"] = new Dictionary<string, object>(),
            },
            // Task10
            [11] = new Dictionary<string, object>
            {
                ["node_id"] = 11,
                ["type"] = "task",
                ["sub_type"] = 10,
                ["decorators"] = new int[] { },
                ["services"] = new int[] { },
                ["properties"] = new Dictionary<string, object>(),
            },
        };

        public static Dictionary<string, object> GetNode(int id)
        {
            Dictionary<string, object> node;
            return Nodes.TryGetValue(id, out node) ? node : null;
        }
    }
}
`;

/** gofmt-clean; the file compiles with Go 1.18+. */
const EXPECTED_GO = `// Code generated by owl-bt from trees/bt_mon_1000.json. DO NOT EDIT.

package behaviortrees

// BtMon1000RootID is the id of the root node.
const BtMon1000RootID = 1

// BtMon1000Nodes holds every node, decorator and service by id.
var BtMon1000Nodes = map[int]map[string]any{
	// Selector - Root
	1: {
		"node_id":    1,
		"type":       "composite",
		"sub_type":   "selector",
		"decorators": []int{},
		"services":   []int{},
		"children":   []int{3, 5, 7},
	},
	// Decorator21
	2: {
		"node_id":                 2,
		"type":                    "decorator",
		"sub_type":                21,
		"inverse_check_condition": false,
		"abort_mode":              0,
		"ignore_check":            false,
		"properties":              map[string]any{},
	},
	// Task27
	3: {
		"node_id":     3,
		"type":        "task",
		"sub_type":    27,
		"finish_once": true,
		"decorators":  []int{2},
		"services":    []int{},
		"properties": map[string]any{
			"sight_dist": 5000,
			"trace_dist": 5000,
		},
	},
	// Decorator24
	4: {
		"node_id":                 4,
		"type":                    "decorator",
		"sub_type":                24,
		"inverse_check_condition": false,
		"abort_mode":              0,
		"ignore_check":            false,
		"properties":              map[string]any{},
	},
	// Task27
	5: {
		"node_id":     5,
		"type":        "task",
		"sub_type":    27,
		"finish_once": true,
		"decorators":  []int{4},
		"services":    []int{},
		"properties": map[string]any{
			"sight_dist": 5000,
			"trace_dist": 5000,
		},
	},
	// Service1
	6: {
		"node_id":  6,
		"type":     "service",
		"sub_type": 1,
		"properties": map[string]any{
			"lock_time":  999999,
			"sight_dist": 300,
			"trace_dist": 3000,
		},
	},
	// Selector
	7: {
		"node_id":    7,
		"type":       "composite",
		"sub_type":   "selector",
		"decorators": []int{},
		"services":   []int{6},
		"children":   []int{8, 11},
	},
	// Sequence
	8: {
		"node_id":    8,
		"type":       "composite",
		"sub_type":   "sequence",
		"decorators": []int{},
		"services":   []int{},
		"children":   []int{9, 10},
	},
	// Task2
	9: {
		"node_id":    9,
		"type":       "task",
		"sub_type":   2,
		"decorators": []int{},
		"services":   []int{},
		"properties": map[string]any{},
	},
	// Task1
	10: {
		"node_id":    10,
		"type":       "task",
		"sub_type":   1,
		"decorators": []int{},
		"services":   []int{},
		"properties": map[string]any{},
	},
	// Task10
	11: {
		"node_id":    11,
		"type":       "task",
		"sub_type":   10,
		"decorators": []int{},
		"services":   []int{},
		"properties": map[string]any{},
	},
}

// BtMon1000GetNode returns the item with the given id, or nil when there is none.
func BtMon1000GetNode(id int) map[string]any {
	return BtMon1000Nodes[id]
}
`;

function goldenModel() {
  const root = nodeFromJson(GOLDEN_TREE, createIdGen('n'));
  return buildExportModel(root, compileProject(GOLDEN_PROJECT));
}

describe('golden export of bt_mon_1000', () => {
  it('reproduces the reference Erlang clauses', () => {
    const erl = toErlang(goldenModel(), {
      module: 'bt_mon_1000',
      sourcePath: 'trees/bt_mon_1000.json',
    });
    const body = erl.slice(erl.indexOf('get_node(1) ->'));
    expect(body).toBe(EXPECTED_ERLANG_BODY);
  });

  it('writes the header with the module, export list and generator line', () => {
    const erl = toErlang(goldenModel(), {
      module: 'bt_mon_1000',
      sourcePath: 'trees/bt_mon_1000.json',
    });
    const dashes = `%%${'-'.repeat(78)}`;
    expect(erl.startsWith(`%% -*- coding: utf-8 -*-\n${dashes}\n%% @File   : bt_mon_1000\n`)).toBe(
      true,
    );
    expect(erl).toContain(
      '%% @Generated by owl-bt from trees/bt_mon_1000.json. Do not edit.\n' +
        `${dashes}\n-module(bt_mon_1000).\n-export([\n    get_node/1,\n    get_root_node/0\n]).\n\n\n%% Selector - Root\nget_node(1) ->`,
    );
  });

  it('reproduces the Lua snapshot', () => {
    const lua = toLua(goldenModel(), { sourcePath: 'trees/bt_mon_1000.json' });
    expect(lua).toBe(EXPECTED_LUA);
  });

  it('reproduces the TypeScript snapshot', () => {
    const ts = toTypeScript(goldenModel(), { sourcePath: 'trees/bt_mon_1000.json' });
    expect(ts).toBe(EXPECTED_TS);
  });

  it('reproduces the C# snapshot', () => {
    const cs = toCSharp(goldenModel(), {
      sourcePath: 'trees/bt_mon_1000.json',
      className: 'BtMon1000',
      namespace: 'BehaviorTrees',
    });
    expect(cs).toBe(EXPECTED_CS);
  });

  it('reproduces the Go snapshot', () => {
    const go = toGo(goldenModel(), {
      sourcePath: 'trees/bt_mon_1000.json',
      packageName: 'behaviortrees',
      namePrefix: 'BtMon1000',
    });
    expect(go).toBe(EXPECTED_GO);
  });
});
