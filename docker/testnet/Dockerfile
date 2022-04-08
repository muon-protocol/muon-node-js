FROM node:16

# Copy over private key, and set permissions
RUN mkdir /root/.ssh/
ADD .ssh/id_rsa /root/.ssh/
ADD .ssh/id_rsa.pub /root/.ssh/
RUN chmod 700 /root/.ssh/id_rsa
RUN chown -R root:root /root/.ssh

RUN touch /root/.ssh/known_hosts
RUN ssh-keyscan github.com >> /root/.ssh/known_hosts

## Create app directory
WORKDIR /usr/src
RUN git clone --branch testnet git@github.com:muon-protocol/muon-node-js.git
WORKDIR /usr/src/muon-node-js

### Install app dependencies
RUN npm i -g pm2
RUN npm install

## Bundle app source
#COPY . .
COPY testnet.env ./.env
COPY ecosystem.config.js .

#EXPOSE 8080

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]
