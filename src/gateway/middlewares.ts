
export const mixGetPost = (req, res, next) => {
  // @ts-ignore
  req.mixed = {
    ...req.query,
    ...req.body,
  }
  next();
}
