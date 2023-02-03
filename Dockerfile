FROM node:16.14

## Create app directory
WORKDIR /usr/src/muon-node-js

## Install app dependencies
COPY package*.json ./
RUN npm i -g @babel/node
RUN npm install

## If you are building your code for production
## RUN npm ci --only=production
#
## Bundle app source
COPY . .

## generate nodes env variables
ENV DOCKER_MODE=1
RUN node testnet-generate-env.js

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

CMD [ "bash", "-c", "service cron start;pm2-runtime start ecosystem.config.cjs" ]
#
