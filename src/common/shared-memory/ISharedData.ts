
export default abstract class ISharedData {
  serialize(): string {
    throw `not implemented`
  }
  static deserialize(data: string): ISharedData {
    throw `not implemented`
  }
}
