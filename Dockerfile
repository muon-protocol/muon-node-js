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

# gateway
EXPOSE 8080

# P2P
EXPOSE 4000

# Add cronjobs
RUN mkdir /root/.ssh/

#ADD .ssh/id_rsa /root/.ssh/
#ADD .ssh/id_rsa.pub /root/.ssh/
#RUN chmod 700 /root/.ssh/id_rsa
#RUN chown -R root:root /root/.ssh

RUN touch /root/.ssh/known_hosts
RUN ssh-keyscan github.com >> /root/.ssh/known_hosts

### Install app dependencies
RUN npm i -g pm2

RUN apt-get update && apt-get -y install cron
RUN ./scripts/auto-update.sh -a setup -p 'muon-node-js-testnet'

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]
#
