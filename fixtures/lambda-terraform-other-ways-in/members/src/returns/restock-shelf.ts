/** The return the restocking workflow is started with. */
interface Returned {
  chute: string;
}

/** Puts a returned book back on its shelf. */
export const handler = async (returned: Returned): Promise<void> => {
  console.log(`restocking from chute ${returned.chute}`);
};
