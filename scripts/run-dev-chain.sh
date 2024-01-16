#!/bin/bash
. "./pre-run.sh"

node_n=2
while getopts n: name; do
    case "$name" in
    n)    node_n=$(($OPTARG));;
    ?)   printf "Usage: %s: [-n value] args\n" $0
          exit 2;;
    esac
done

start_node(){
    `./node_modules/.bin/env-cmd -f ./dev-chain/dev-node-$i.env ./node_modules/.bin/babel-node index.js`
}

echo "running dev-chain with $node_n node ..."
for i in $(seq 1 $node_n)
do
    start_node $i &
done
wait
