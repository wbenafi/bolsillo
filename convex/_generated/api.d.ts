/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as domain from "../domain.js";
import type * as http from "../http.js";
import type * as r2 from "../r2.js";
import type * as superadmin from "../superadmin.js";
import type * as tags from "../tags.js";
import type * as transactionDomain from "../transactionDomain.js";
import type * as transactionFiles from "../transactionFiles.js";
import type * as transactions from "../transactions.js";
import type * as users from "../users.js";
import type * as wallets from "../wallets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  crons: typeof crons;
  domain: typeof domain;
  http: typeof http;
  r2: typeof r2;
  superadmin: typeof superadmin;
  tags: typeof tags;
  transactionDomain: typeof transactionDomain;
  transactionFiles: typeof transactionFiles;
  transactions: typeof transactions;
  users: typeof users;
  wallets: typeof wallets;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
