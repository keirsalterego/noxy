require('dotenv').config();

const http = require('http');
const { URL } = require('url');
const EventEmitter = require('events');
const net = require('net');

const PROXY_PORT = process.env.PROXY_PORT || 8080;

class Noxy extends EventEmitter {
  constructor() {
    super();

    this._server = http.createServer((clientRequest, clientResponse) => {
      this.emit('request', clientRequest, clientResponse);
    });

    this._server.on('connect', (clientRequest, clientSocket, head) => {
      this.emit('connect', clientRequest, clientSocket, head);
    });

    this.on('request', this._handleHttpRequest);
    this.on('connect', this._handleHttpsConnectRequest);
  }

  _handleHttpRequest(clientRequest, clientResponse) {
    if (!clientRequest.url.startsWith('http')) {
      clientResponse.writeHead(400, { 'Content-Type': 'text/plain' });
      clientResponse.end('Bad Request: This is a proxy server, not a web server. Please provide a full URL.');
      return;
    }

    const targetURL = clientRequest.url;
    console.log(`Noxy is proxying HTTP request to: ${targetURL}`);

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

  _handleHttpsConnectRequest(clientRequest, clientSocket, head) {
    const { port, hostname } = new URL(`http://${clientRequest.url}`);
    const targetPort = port || 443;

    console.log(`Noxy is creating a tunnel to: ${hostname}:${targetPort}`);

    const targetSocket = net.connect(targetPort, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });

    targetSocket.on('error', (error) => {
      console.error(`Error with the tunnel to ${hostname}:${targetPort}:`, error);
      clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    });

    clientSocket.on('error', (error) => {
      console.error(`Error with the client socket:`, error);
      targetSocket.end();
    });
  }

  start() {
    this._server.listen(PROXY_PORT, () => {
      console.log(`Noxy is alive and listening on port ${PROXY_PORT}`);
      console.log(`Configure your browser to use http://localhost:${PROXY_PORT} for HTTP and HTTPS.`);
    });

    this._server.on('error', (error) => {
      console.error('A server error occurred:', error);
    });
  }
}

const proxy = new Noxy();
proxy.start();