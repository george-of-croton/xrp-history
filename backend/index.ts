import { plot } from "asciichart";
import { getKnex, logger, post, uuid, wait } from "./lib";

const getAccountFirstTransaction = async (account: string) => {
  return post(
    "https://s1.ripple.com:51234",
    {
      method: "account_tx",
      params: [
        {
          account,
          binary: false,
          forward: true,
          ledger_index_max: -1,
          ledger_index_min: 0,
          limit: 1,
        },
      ],
    },
    (data) => data
  );
};

const parseRippleDate = (rippleTimestamp: number) => {
  // https://xrpl.org/basic-data-types.html#specifying-time
  const base = 946684800 * 1000;

  return new Date(rippleTimestamp * 1000 + base);
};

const getTransactionDate = (transactions: any[]) => {
  const [transaction] = transactions;
  return parseRippleDate(transaction.tx.date);
};

const getAccountInfoAtLedger = async (account: string, ledger: number) => {
  const accountResult = await post(
    "https://s1.ripple.com:51234",
    {
      method: "account_info",
      params: [
        {
          account,
          // strict: true,
          ledger_index: ledger,
          // queue: true,
        },
      ],
    },
    (data) => data
  );

  const ledgerResult = await post(
    "https://s1.ripple.com:51234",
    {
      method: "ledger",
      params: [
        {
          ledger_index: ledger,
          accounts: false,
          full: false,
          transactions: false,
          expand: false,
          owner_funds: false,
        },
      ],
    },
    (data) => data
  );

  const rippleDate = ledgerResult.result.ledger.close_time;

  const data = {
    balance: accountResult.result.account_data.Balance,
    account: accountResult.result.account_data.Account,
    ledgerIndex: accountResult.result.ledger_index,
    date: parseRippleDate(rippleDate),
  };

  return data;
};

const dropsToRipple = (drops: number) => drops / 1e6;

export const insertBalanceRow = async (accountInfo: any) => {
  const knex = await getKnex();
  await knex("balance").insert({
    id: uuid(),
    balance: dropsToRipple(accountInfo.balance),
    date: accountInfo.date,
    account: accountInfo.account,
    ledger_index: accountInfo.ledgerIndex,
    created_at: new Date(),
  });
};

const oneDayInLedgers = 28800;

const getNextBalance = async () => {
  const knex = await getKnex();

  const [previousRecord] = await knex("balance")
    .orderBy("date", "desc")
    .limit(1);

  if (previousRecord.date + 1000 * 60 * 60 * 24 > Date.now()) {
    logger.info("balance records up to date");
    await wait(1000 * 60);
  }
  const nextLedger = previousRecord.ledger_index + oneDayInLedgers;
  const accountInfo = await getAccountInfoAtLedger(
    previousRecord.account,
    nextLedger
  );

  await insertBalanceRow(accountInfo);

  const datapoints = await knex("balance").orderBy("date", "desc").limit(50);
  console.clear();
  console.log(
    plot(datapoints.map(({ balance }) => balance).reverse(), { height: 20 })
  );
  await getNextBalance();
};

const start = async () => {
  const knex = await getKnex();
  const [, , account = "rnqZnvzoJjdg7n1P9pmumJ7FQ5wxNH3gYC"] = process.argv;

  const [previousRecord] = await knex("balance")
    .orderBy("date", "desc")
    .limit(1);

  if (!previousRecord) {
    const data = await getAccountFirstTransaction(account);
    const accountInfo = await getAccountInfoAtLedger(
      account,
      data.result.marker.ledger
    );
    await insertBalanceRow(accountInfo);
  }
  getNextBalance();
};

start();
