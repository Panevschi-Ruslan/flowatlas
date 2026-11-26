import axios from 'axios';

/** A base chosen at run time: nothing here can say which service it is. */
export const legacyApi = axios.create({ baseURL: localStorage.getItem('api-base') ?? '' });
