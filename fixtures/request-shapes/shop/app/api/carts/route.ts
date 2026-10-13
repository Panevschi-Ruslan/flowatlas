import { NextResponse, type NextRequest } from 'next/server';

interface CartInput {
  customerId: string;
}

interface CartCreated {
  id: string;
  customerId: string;
}

/**
 * A route file's handler. The body is what `await request.json()` is said to
 * be - a cast, so claimed - and the answer is handed to `NextResponse.json`,
 * a failure with its status beside it.
 */
export async function POST(request: NextRequest) {
  const input = (await request.json()) as CartInput;
  if (input.customerId === '') {
    return NextResponse.json({ error: 'customer required' }, { status: 422 });
  }
  const created: CartCreated = { id: 'cart-1', customerId: input.customerId };
  return NextResponse.json(created, { status: 201 });
}
