const avg = arr => {
  let sum = 0
  for(let i=0 ; i<arr.length ; i++)
    sum += arr[i]
  return sum / arr.length
}

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
    if(Object.keys(conns).length !== nodes.length)
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

  /** fill the one-way missed times */
  let nodesList = Object.keys(graph);
  for(const [src, connections] of Object.entries(graph)) {
    for(const dest of nodesList) {
      if(connections[dest]===undefined && !!graph[dest][src])
        connections[dest] = graph[dest][src]
    }
  }

  /** remove redundant nodes */
  for(const [src, connections] of Object.entries(graph)) {
    for(const [dest, weight] of Object.entries(connections)) {
      if(graph[dest]===undefined)
        delete connections[dest];
    }
    if(Object.keys(connections).length === 0)
      delete graph[src];
  }

  /**
   * sort nodes order by connections|weight|ID
   * nodes with larger amounts of connections or lower ID have more priority to be selected.
   */
  let sortedNodes = Object.keys(graph)
    .sort((a, b) => {
      /** more connections has more priority */
      if(Object.keys(graph[a]).length > Object.keys(graph[b]).length)
        return 1
      if(Object.keys(graph[b]).length > Object.keys(graph[a]).length)
        return -1

      /** lower connection weight has more priority */
      if(Math.max(...Object.values(graph[a])) < Math.max(...Object.values(graph[b])))
        return 1
      if(Math.max(...Object.values(graph[b])) < Math.max(...Object.values(graph[a])))
        return -1

      /** lower ID has more priority */
      return parseInt(a) < parseInt(b) ? 1 : -1
    })

  /** remove low priority nodes one by one, in order to graph be fully connected. */
  for(let i=0 ; i<sortedNodes.length && !isGraphFullyConnected(graph) ; i++) {
    removeGraphNode(graph, sortedNodes[i]);
  }
  return graph;
}

export function findMinFullyConnectedSubGraph(inputGraph: WeightedGraph, n: number): WeightedGraph {
  const graph = getFullyConnectedSubGraph(inputGraph)
  const numNodesToDelete = Math.max(Object.keys(graph).length - n, 0);

  /**
   * sort nodes order by weight|ID
   * nodes with larger weight of connections or lower ID have more priority to be selected.
   */
  let sortedNodes = Object.keys(graph)
    .sort((a, b) => {
      /** lower connection weight has more priority */
      if(avg(Object.values(graph[a])) < avg(Object.values(graph[b])))
        return 1
      if(avg(Object.values(graph[b])) < avg(Object.values(graph[a])))
        return -1


      /** lower ID has more priority */
      return parseInt(a) < parseInt(b) ? 1 : -1
    })
    .map(entry => entry[0])

  for(let del of sortedNodes.slice(0, numNodesToDelete)) {
    removeGraphNode(graph, del)
  }

  return graph
}

