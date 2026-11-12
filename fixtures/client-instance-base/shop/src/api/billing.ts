import ky from 'ky';

import { BILLING_HOST } from '../config';

/** The billing service, by the host it is reached at. ky writes its paths without the opening slash. */
export default ky.create({ prefixUrl: BILLING_HOST });
