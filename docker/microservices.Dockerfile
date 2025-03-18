FROM ubuntu:20.04
RUN apt-get update
RUN DEBIAN_FRONTEND="noninteractive" apt-get install -y curl git build-essential 
RUN DEBIAN_FRONTEND="noninteractive" apt-get install -y fontconfig ttf-mscorefonts-installer fonts-dejavu fonts-liberation fonts-freefont-ttf
RUN fc-cache -vr

RUN DEBIAN_FRONTEND="noninteractive" && apt-get install -y ghostscript imagemagick unoconv
RUN mv /etc/ImageMagick-6/policy.xml /etc/ImageMagick-6/policy.xml.off

RUN curl -sL https://deb.nodesource.com/setup_18.x -o nodesource_setup.sh
RUN bash nodesource_setup.sh
RUN apt install -y nodejs

COPY ./_secrets/ssh/github /root/.ssh/id_rsa
RUN chmod -R 700 /root/.ssh
RUN chmod 600 /root/.ssh/id_rsa && echo "StrictHostKeyChecking no" > /root/.ssh/config
RUN ssh-keyscan github.com >> /root/.ssh/known_hosts
RUN /bin/bash -c "echo '${SSH_PRIVATE_KEY}' >> /root/.ssh/id_rsa"

WORKDIR /usr/src/app
RUN git clone "git@github.com:panagonov/microservices.git" .

ENV NODE_ENV=production

WORKDIR /usr/src/app
RUN git reset --hard origin/master
RUN git pull
RUN npm install
RUN cd file_convert && npm install
RUN cd file_manager && npm install
RUN cd file_utils && npm install
RUN cd redis_service && npm install