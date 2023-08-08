FROM node:18.17.0

## Create app directory
WORKDIR /usr/src/muon-node-js

## Install app dependencies
COPY package*.json ./
RUN npm i -g @babel/node
RUN npm install

## If you are building your code for production
## RUN npm ci --only=production

ENV NODE_ENV=production

## Bundle app source
COPY . .

ENV DOCKER_MODE=1

# gateway
EXPOSE 8000

# P2P
EXPOSE 4000

# Add cronjobs
RUN mkdir /root/.ssh/

RUN touch /root/.ssh/known_hosts
RUN ssh-keyscan github.com >> /root/.ssh/known_hosts

### Install app dependencies
RUN npm i -g pm2
RUN pm2 install pm2-logrotate

RUN apt-get update && apt-get -y install cron
RUN ./scripts/auto-update.sh -a setup -p 'muon-node-js-testnet'

CMD [ "bash", "-c", "node testnet-generate-env.js; service cron start; pm2 start ecosystem.config.cjs; sleep infinity" ]
#
