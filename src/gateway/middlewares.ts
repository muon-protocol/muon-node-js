
export const mixGetPost = (req, res, next) => {
  req.mixed = {
    ...req.query,
    ...req.body,
  }
  next();
}
