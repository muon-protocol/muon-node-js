FROM node:16

# Copy over private key, and set permissions
RUN mkdir /root/.ssh/
ADD .ssh/id_rsa /root/.ssh/
ADD .ssh/id_rsa.pub /root/.ssh/
RUN chmod 700 /root/.ssh/id_rsa
RUN chown -R root:root /root/.ssh

RUN touch /root/.ssh/known_hosts
RUN ssh-keyscan github.com >> /root/.ssh/known_hosts

## Clone muon-node-js source
WORKDIR /usr/src
RUN git clone --branch testnet git@github.com:muon-protocol/muon-node-js.git
WORKDIR /usr/src/muon-node-js

### Install app dependencies
RUN npm i -g pm2
RUN npm install

COPY testnet.env ./.env
COPY ecosystem.config.js .
COPY config/* ./config/

RUN apt-get update && apt-get -y install cron
RUN ./scripts/auto-update.sh -a setup -p 'muon-node-js-testnet'

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]
