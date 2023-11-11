FROM node:18.17.0

RUN mkdir /root/.ssh/

# RUN touch /root/.ssh/known_hosts
# RUN ssh-keyscan github.com >> /root/.ssh/known_hosts

## Create app directory
WORKDIR /usr/src
## clone te project
RUN git clone https://github.com/muon-protocol/muon-node-js.git --recurse-submodules -b bug-fix
## Install app dependencies
WORKDIR /usr/src/muon-node-js

RUN npm i -g @babel/node
RUN npm i -g pm2
RUN pm2 install pm2-logrotate
RUN npm install


ENV DOCKER_MODE=1

# gateway
EXPOSE 8000

# P2P
EXPOSE 4000

CMD [ "bash", "-c", "npx ts-node ./devnet/generate-envs.js -- -t=2 -n=10; pm2 start devnet/ecosystem.config.cjs; sleep infinity" ]
#
