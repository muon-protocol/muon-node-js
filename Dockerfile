FROM node:16

## Create app directory
WORKDIR /usr/src/muon-node-js
#
## Install app dependencies
COPY package*.json ./
#
RUN npm i -g @babel/node
RUN npm install
## If you are building your code for production
## RUN npm ci --only=production
#
## Bundle app source
COPY . .
#
## generate nodes env variables
ARG INFURA_PROJECT_ID
ENV INFURA_PROJECT_ID=${INFURA_PROJECT_ID}
ENV MONGO_HOST="muon_mongo"
ENV REDIS_HOST="muon_redis"
ENV DOCKER_MODE=1
RUN node devnet-generate-envs.js -n=4 -p=8080

EXPOSE 8080

CMD [ "node", "devnet-run.js", "-n=4" ]
