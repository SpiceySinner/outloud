type JsonInit = ResponseInit & {
  status?: number;
};

export const NextResponse = {
  json(body: unknown, init?: JsonInit) {
    return Response.json(body, init);
  },
};
