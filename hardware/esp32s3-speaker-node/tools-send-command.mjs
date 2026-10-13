#!/usr/bin/env node
import dgram from 'node:dgram';
import crypto from 'node:crypto';
const host=process.argv[2]||'192.168.4.2';
const type=process.argv[3]||'startAt';
const leadMs=Number(process.argv[4]||1500);
const offsetUs=Number(process.argv[5]||0);
const nonce=BigInt(Date.now())*1000n+BigInt(Math.floor(Math.random()*1000));
const hostTimeUs=Math.floor(performance.timeOrigin*1000+performance.now()*1000)+Math.round(leadMs*1000);
const positionFrames=0;
const psk=process.env.SONICSYNC_PSK||'';
const canonical=`${type}|${hostTimeUs}|${positionFrames}|${offsetUs}|${nonce}`;
const packet={type,hostTimeUs,positionFrames,clockOffsetUs:offsetUs,nonce:Number(nonce)};
if(psk) packet.auth=crypto.createHmac('sha256',psk).update(canonical).digest('hex');
const socket=dgram.createSocket('udp4'); socket.send(Buffer.from(JSON.stringify(packet)),8788,host,()=>{console.log(JSON.stringify({host,packet}));socket.close();});
