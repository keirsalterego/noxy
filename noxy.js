require('dotenv').config(); 

const http = require('http');
const { URL } = require('url');
const EventEmitter = require('events');
const net = require('net');
const axios = require('axios');
const chalk = require('chalk');

const PROXY_PORT = process.env.PROXY_PORT || 8080;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;


async function checkSiteSafety(url) {
  if (!GOOGLE_API_KEY) {
    return chalk.yellow(`[SAFETY: ORANGE] Skipping ${url} (GOOGLE_API_KEY not set)`);
  }
  const GSAFE_URL = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${GOOGLE_API_KEY}`;
  try {
    const response = await axios.post(GSAFE_URL, {
      client: { clientId: 'noxy-proxy', clientVersion: '1.0.0' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url: url }],
      },
    });
    if (response.data && response.data.matches) {
      return chalk.red.bold(`[SAFETY: RED] Dangerous site detected: ${url}`);
    } else {
      return chalk.green(`[SAFETY: GREEN] Safe site: ${url}`);
    }
  } catch (error) {
    return chalk.orange(`[SAFETY: ORANGE] Could not verify site ${url}`);
  }
}


class Noxy extends EventEmitter {
  constructor() {
    super();
    this._server = http.createServer((clientRequest, clientResponse) => {
      this.emit('request', clientRequest, clientResponse);
    });
    this._server.on('connect', (clientRequest, clientSocket, head) => {
      this.emit('connect', clientRequest, clientSocket, head);
    });
    this.on('request', this._handleHttpRequest.bind(this));
    this.on('connect', this._handleHttpsConnectRequest.bind(this));
  }

  async _handleHttpRequest(clientRequest, clientResponse) {
    if (!clientRequest.url.startsWith('http')) {
      clientResponse.writeHead(400, { 'Content-Type': 'text/plain' });
      clientResponse.end('Bad Request: This is a proxy server. Please provide a full URL.');
      return;
    }
    const targetURL = clientRequest.url;
    const safetyReport = await checkSiteSafety(targetURL);
    console.log(safetyReport);
    console.log(`(HTTP)  Proxying to: ${targetURL}`);
    const url = new URL(targetURL);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: clientRequest.method,
      headers: clientRequest.headers,
    };
    const proxyRequest = http.request(options, (targetResponse) => {
      clientResponse.writeHead(targetResponse.statusCode, targetResponse.headers);
      targetResponse.pipe(clientResponse);
    });
    proxyRequest.on('error', (error) => {
      console.error(`Error with HTTP request to ${targetURL}:`, error);
      clientResponse.writeHead(500, { 'Content-Type': 'text/plain' });
      clientResponse.end('Oops, something went wrong on our end.');
    });
    clientRequest.pipe(proxyRequest);
  }

  async _handleHttpsConnectRequest(clientRequest, clientSocket, head) {
    const { port, hostname } = new URL(`http://${clientRequest.url}`);
    const targetPort = port || 443;
    const safetyReport = await checkSiteSafety(hostname);
    console.log(safetyReport);
    console.log(`(HTTPS) Creating tunnel to: ${hostname}:${targetPort}`);
    const targetSocket = net.connect(targetPort, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });
    targetSocket.on('error', (error) => {
      console.error(`Error with tunnel to ${hostname}:${targetPort}:`, error);
      clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    });
    clientSocket.on('error', (error) => {
      console.error(`Client socket error:`, error);
      targetSocket.end();
    });
  }

  start() {
    if (!GOOGLE_API_KEY) {
      console.log(chalk.bgYellow.black.bold(' WARNING: GOOGLE_API_KEY is not set in .env file. '));
      console.log(chalk.yellow('Safety checks will be skipped (everything will be ORANGE).\n'));
    }
    this._server.listen(PROXY_PORT, () => {
      console.log(`Noxy is alive and listening on port ${PROXY_PORT}`);
      console.log(`Configure your browser to use http://localhost:${PROXY_PORT} for HTTP and HTTPS.`);
    });
    this._server.on('error', (error) => {
      console.error('A server error occurred:', error);
    });
  }
}

// --- LOGIC CHANGE ---

// DELETED:
// const proxy = new Noxy();
// proxy.start();

// ADDED:
// Now, it can be exported as class to other files   
module.exports = { Noxy };