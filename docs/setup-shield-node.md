# Setup a Muon Shield Node


### Clone the repository

```
git clone git@github.com:muon-protocol/muon-node-js.git --recurse-submodules --branch testnet
```

### Build and run the node

```
cd muon-node-js
docker-compose build
docker-compose up -d
```

### Enable shielding

To configure a node as a shield node two variables should be defined in the node configuration file.
- `SHIELDED_APPS`: The list of apps that the node shields them
- `SHIELD_FORWARD_URL`: The muon network that the shield node should forward the request to and get the threshold signature from.

Replace `http://localhost:8000/v1/` and `app1|app2` with desired values, and use the following commands to add these two variables to the `.env` configuration file of the node inside the `muon-node` container.

```
docker exec muon-node bash -c 'echo -e "\n\nSHIELD_FORWARD_URL=http://localhost:8000/v1/" >> ".env"'
docker exec muon-node bash -c 'echo -e "\nSHIELDED_APPS=app1|app2" >> ".env"'
```

