const getKeys = obj => Object.keys(obj);
const getVals = obj => Object.values(obj);

export type UnweightedGraph = {
  [index: string]: string []
}

export type WeightedGraph = {
  [index: string]: {
    [index: string]: number
  }
}

export function toUnweightedGraph(graph: WeightedGraph): UnweightedGraph {
  return Object.entries(graph).reduce((obj, [n, conn]) => {
    obj[n] = Object.keys(conn)
    return obj;
  }, {})
}

function isGraphFullyConnected(graph: WeightedGraph): boolean {
  const nodes = Object.keys(graph)
  for(const [node, conns] of Object.entries(graph)) {
    if(getKeys(conns).length !== nodes.length)
      return false
  }
  return true;
}

function removeGraphNode(graph: WeightedGraph, removingNode: string) {
  delete graph[removingNode]
  Object.keys(graph).forEach(node => {
    delete graph[node][removingNode]
  })
}

export function getFullyConnectedSubGraph(inputGraph: WeightedGraph) {
  let graph: WeightedGraph;
  /** clone input graph */
  try {
    graph = JSON.parse(JSON.stringify(inputGraph))
  }catch (e) {
    return {}
  }

  /** remove Unidirectional edges */
  for(const [src, connections] of Object.entries(graph)) {
    for(const [dest, weight] of Object.entries(connections)) {
      if(graph[dest]===undefined || graph[dest][src]===undefined)
        delete connections[dest];
    }
  }

  /**
   * sort nodes order by connections|weight|ID
   * nodes with larger amounts of connections or lower ID have more priority to be selected.
   */
  let sortedNodes = Object.entries(graph)
    .sort(([key1, conn1], [key2, conn2]) => {
      return (
        /** more connections has more priority */
        getKeys(conn1).length > getKeys(conn2).length
        /** lower connection weight has more priority */
        // @ts-ignore
        || Math.max(...getVals(conn1)) < Math.max(...getVals(conn2))
        /** lower ID has more priority */
        || parseInt(key1) < parseInt(key2)
      ) ? 1 : -1
    })
    .map(entry => entry[0])

  /** remove low priority nodes one by one, in order to graph be fully connected. */
  for(let i=0 ; i<sortedNodes.length && !isGraphFullyConnected(graph) ; i++) {
    removeGraphNode(graph, sortedNodes[i]);
  }
  return graph;
}

export function findMinFullyConnectedSubGraph(inputGraph: WeightedGraph, n: number): WeightedGraph {
  const graph = getFullyConnectedSubGraph(inputGraph)
  const numNodesToDelete = Math.max(getKeys(graph).length - n, 0);

  /**
   * sort nodes order by weight|ID
   * nodes with larger weight of connections or lower ID have more priority to be selected.
   */
  let sortedNodes = Object.entries(graph)
    .sort(([key1, conn1], [key2, conn2]) => {
      return (
        /** lower connection weight has more priority */
        // @ts-ignore
        Math.max(...getVals(conn1)) < Math.max(...getVals(conn2))
        /** lower ID has more priority */
        || parseInt(key1) < parseInt(key2)
      ) ? 1 : -1
    })
    .map(entry => entry[0])

  for(let del of sortedNodes.slice(0, numNodesToDelete)) {
    removeGraphNode(graph, del)
  }

  return graph
}

