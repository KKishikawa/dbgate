const stableStringify = require('json-stable-stringify');
const childProcessChecker = require('../utility/childProcessChecker');
const requireEngineDriver = require('../utility/requireEngineDriver');
const { decryptConnection } = require('../utility/crypting');

let systemConnection;
let storedConnection;
let lastDatabases = null;
let lastStatus = null;
let lastPing = null;

async function handleRefresh() {
  const driver = requireEngineDriver(storedConnection);
  try {
    const databases = await driver.listDatabases(systemConnection);
    setStatusName('ok');
    const databasesString = stableStringify(databases);
    if (lastDatabases != databasesString) {
      process.send({ msgtype: 'databases', databases });
      lastDatabases = databasesString;
    }
  } catch (err) {
    setStatus({
      name: 'error',
      message: err.message,
    });
    // console.error(err);
    setTimeout(() => process.exit(1), 1000);
  }
}

function setStatus(status) {
  const statusString = stableStringify(status);
  if (lastStatus != statusString) {
    process.send({ msgtype: 'status', status });
    lastStatus = statusString;
  }
}

function setStatusName(name) {
  setStatus({ name });
}

async function handleConnect(connection) {
  storedConnection = connection;
  setStatusName('pending');
  lastPing = new Date().getTime();

  const driver = requireEngineDriver(storedConnection);
  try {
    systemConnection = await driver.connect(decryptConnection(storedConnection));
    handleRefresh();
    setInterval(handleRefresh, 30 * 1000);
  } catch (err) {
    setStatus({
      name: 'error',
      message: err.message,
    });
    // console.error(err);
    setTimeout(() => process.exit(1), 1000);
  }
}

function handlePing() {
  lastPing = new Date().getTime();
}

async function handleCreateDatabase({ name }) {
  const driver = requireEngineDriver(storedConnection);
  systemConnection = await driver.connect(decryptConnection(storedConnection));
  console.log(`RUNNING SCRIPT: CREATE DATABASE ${driver.dialect.quoteIdentifier(name)}`);
  await driver.query(systemConnection, `CREATE DATABASE ${driver.dialect.quoteIdentifier(name)}`);
  await handleRefresh();
}

const messageHandlers = {
  connect: handleConnect,
  ping: handlePing,
  createDatabase: handleCreateDatabase,
};

async function handleMessage({ msgtype, ...other }) {
  const handler = messageHandlers[msgtype];
  await handler(other);
}

function start() {
  childProcessChecker();

  setInterval(() => {
    const time = new Date().getTime();
    if (time - lastPing > 60 * 1000) {
      process.exit(0);
    }
  }, 60 * 1000);

  process.on('message', async (message) => {
    try {
      await handleMessage(message);
    } catch (err) {
      setStatus({
        name: 'error',
        message: err.message,
      });
    }
  });
}

module.exports = { start };
