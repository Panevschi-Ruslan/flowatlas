/** Whether this is a production run: decided where the code runs, never written. */
const isProd = process.env.NODE_ENV === 'production';

/** A chain whose second operand is a condition nobody settles, and a setting read after it. */
const mirrorBase = () => process.env.PRIMARY_URL || (isProd ? process.env.EAST_URL : process.env.WEST_URL) || process.env.ARCHIVE_URL;

/** Both branches' services serve it: a row, the two branches read as one tier. */
export const regions = () => fetch(`${mirrorBase()}/regions`).then((res) => res.json());

/** Only the second branch's service serves it: joined there, as a guess. */
export const westOnly = () => fetch(`${mirrorBase()}/west-only`).then((res) => res.json());

/** Only the service of the setting after the condition serves it: joined there, as a guess. */
export const exportsList = () => fetch(`${mirrorBase()}/exports`).then((res) => res.json());

/** The first setting's service serves it: the join it always was. */
export const primaryOnly = () => fetch(`${mirrorBase()}/primary-only`).then((res) => res.json());

/** Inventory's container, published on 8080, listening where its environment file puts it. */
export const items = () => fetch('http://localhost:8080/items').then((res) => res.json());

/** The same container on the compose network, at the port its environment file gives. */
export const itemsInNetwork = () => fetch('http://inventory:4000/items').then((res) => res.json());

/** Billing's container, published on 8081, listening where its image's runtime stage puts it. */
export const invoices = () => fetch('http://localhost:8081/invoices').then((res) => res.json());
