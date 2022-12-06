# Setup a Muon Shield node


## 1) Install and Run the Muon Node

### Clone the repository

```
git clone git@github.com:muon-protocol/muon-node-js.git --recurse-submodules --branch testnet
```

### Build and run docker

```
cd muon-node-js
docker-compose build
docker-compose up -d
```

### Enable shield for some apps

shield not enabled by default for any app. you should enable it for any app you want.
replace `http://localhost:8000/v1/` with your network url and `app1|app2` with a list of apps that you want to shield. separate each app with `|` mark.

```
docker exec muon-node bash -c 'echo -e "\n\nSHIELD_FORWARD_URL=http://localhost:8000/v1/\nSHIELDED_APPS=app1|app2" >> ".env"'
```

