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
ENV DOCKER_MODE=1
RUN node testnet-generate-env.js

EXPOSE 8080

CMD [ "npm", "start" ]
