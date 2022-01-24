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
ENV MONGO_HOST="muon_mongo"
ENV REDIS_HOST="muon_redis"
ENV DOCKER_MODE=1
RUN node generateEnvs.js -n=4 -p=8080

EXPOSE 8080

CMD [ "node", "runNode.js", "-n=4" ]
