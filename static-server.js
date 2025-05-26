// === CONFIGURABLE VARIABLES ===
const HOSTNAME = '0.0.0.0';
const HTTPS_PORT = 443;
const HTTP_PORT = 80;

const STATIC_FILES_DIR = './public'; // Enter a relative or absolute path
const SSL_CERT_PATH = './certs/cert.pem';
const SSL_KEY_PATH = './certs/key.pem';

const ENABLE_HTTPS = true;
const ENABLE_HTTP2 = true;
const REDIRECT_HTTP_TO_HTTPS = true;
const ENABLE_HTTP = false;
const ENABLE_BROTLI = true;
const ENABLE_GZIP = true;
const ENABLE_CORS = false;
const ENABLE_CACHE_CONTROL = true;
const CACHE_MAX_AGE_SECONDS = 3600;
const ENABLE_ETAG = true;
// ==============================

const fs = require('fs');
const path = require('path');
const url = require('url');

const mimeTypes = {
  '.avi': 'video/x-msvideo',
  '.br': 'application/brotli',
  '.bz2': 'application/x-bzip2',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.eot': 'application/vnd.ms-fontobject',
  '.flv': 'video/x-flv',
  '.gif': 'image/gif',
  '.gz': 'application/gzip',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'application/font-otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tar': 'application/x-tar',
  '.tar.bz2': 'application/x-bzip2',
  '.tar.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.ttf': 'application/font-ttf',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.wmv': 'video/x-ms-wmv',
  '.woff': 'application/font-woff',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
  '.zip': 'application/zip'
};

function generateETag(buffer) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function handleRequest(req, res) {
  if (ENABLE_CORS) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, Range, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  const parsedUrl = url.parse(req.url);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname.includes('\0')) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  const resolvedFilesDir = path.resolve(__dirname, STATIC_FILES_DIR);
  const safePath = path.normalize(path.join(resolvedFilesDir, pathname));

  if (!safePath.startsWith(resolvedFilesDir)) {
    res.writeHead(403);
    res.end('Access denied');
    return;
  }

  if (path.basename(safePath).startsWith('.')) {
    res.writeHead(403);
    res.end('Access denied');
    return;
  }

  let filePath = safePath;

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const indexHtml = path.join(filePath, 'index.html');
    const indexHtm = path.join(filePath, 'index.htm');
    if (fs.existsSync(indexHtml)) filePath = indexHtml;
    else if (fs.existsSync(indexHtm)) filePath = indexHtm;
    else {
      res.writeHead(403);
      res.end('Directory listing not allowed');
      return;
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('File not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': mimeType,
    };

    if (ENABLE_CACHE_CONTROL) {
      headers['Cache-Control'] = `public, max-age=${CACHE_MAX_AGE_SECONDS}`;
    }

    if (ENABLE_ETAG) {
      const etag = generateETag(fs.readFileSync(filePath));
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304);
        res.end();
        return;
      }
      headers['ETag'] = etag;
    }

    const range = req.headers.range;
    const totalSize = stats.size;

    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
        res.end();
        return;
      }

      const start = match[1] === '' ? 0 : parseInt(match[1], 10);
      const end = match[2] === '' ? totalSize - 1 : parseInt(match[2], 10);

      if (isNaN(start) || isNaN(end) || start > end || end >= totalSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
      headers['Accept-Ranges'] = 'bytes';
      headers['Content-Length'] = chunkSize;
      res.writeHead(206, headers);
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    const acceptEncoding = req.headers['accept-encoding'] || '';
    const stream = fs.createReadStream(filePath);
    const compressedExts = ['.gz', '.tgz', '.zip', '.bz2', '.br', '.tar.bz2', '.tar.gz'];

    if (!compressedExts.includes(ext)) {
	  const zlib = require('zlib');
      if (ENABLE_BROTLI && acceptEncoding.includes('br')) {
        headers['Content-Encoding'] = 'br';
        res.writeHead(200, headers);
        stream.pipe(zlib.createBrotliCompress()).pipe(res);
        return;
      } else if (ENABLE_GZIP && acceptEncoding.includes('gzip')) {
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, headers);
        stream.pipe(zlib.createGzip()).pipe(res);
        return;
      }
    }

    headers['Content-Length'] = totalSize;
    res.writeHead(200, headers);
    stream.pipe(res);
  });
}

if (!ENABLE_HTTPS && !ENABLE_HTTP && !REDIRECT_HTTP_TO_HTTPS) {
  console.error('At least one type of server must be enabled.');
  process.exit(1);
}

if (ENABLE_HTTPS) {
  try {
    let sslOptions = {
      key: fs.readFileSync(SSL_KEY_PATH),
      cert: fs.readFileSync(SSL_CERT_PATH)
    };
  } catch (err) {
    console.error('Failed to load SSL certificate or key:', err.message);
    process.exit(1);
  }

  if (ENABLE_HTTP2) {
    const http2 = require('http2');
    http2.createSecureServer(sslOptions, handleRequest).listen(HTTPS_PORT, HOSTNAME, () => {
      console.log(`HTTP/2 server running at https://${HOSTNAME}:${HTTPS_PORT}/`);
    });
  } else {
    const https = require('https');
    https.createServer(sslOptions, handleRequest).listen(HTTPS_PORT, HOSTNAME, () => {
      console.log(`HTTPS server running at https://${HOSTNAME}:${HTTPS_PORT}/`);
    });
  }
}

if (ENABLE_HTTP || REDIRECT_HTTP_TO_HTTPS) {
  const http = require('http');
  const httpHandler = REDIRECT_HTTP_TO_HTTPS
    ? (req, res) => {
        const host = req.headers.host?.split(':')[0] || HOSTNAME;
        const location = `https://${host}:${HTTPS_PORT}${req.url}`;
        res.writeHead(301, { Location: location });
        res.end();
      }
    : handleRequest;

  http.createServer(httpHandler).listen(HTTP_PORT, HOSTNAME, () => {
    console.log(
      REDIRECT_HTTP_TO_HTTPS
        ? `HTTP redirect server running at http://${HOSTNAME}:${HTTP_PORT}/`
        : `HTTP server running at http://${HOSTNAME}:${HTTP_PORT}/`
    );
  });
}
