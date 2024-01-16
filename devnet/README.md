#Local devnet

## Initialize

generate a network with 10 nodes and tss threshold of 2.

    npm run devnet-init -- -t=2 -n=10 -infura=<your-infura-project-id>
    
## run
run the network with 3 nodes and any 2 of 3 nodes can sign the request.

    npm run devnet-run -- -n=3
