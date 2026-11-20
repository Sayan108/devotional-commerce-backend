import { HttpError, clean, phoneNumber, token, validPhone } from "./common.js";

export async function checkedAddress(input, catalog, session) {
  const address = {
    label: clean(input?.label, 30) || "Home", name: clean(input?.name), phone: phoneNumber(input?.phone),
    street: clean(input?.street, 250), locality: clean(input?.locality), pin: clean(input?.pin)
  };
  const fields = {};
  if (address.name.length < 2) fields.name = "Enter the recipient's full name.";
  if (!validPhone(address.phone)) fields.phone = "Enter a valid delivery mobile number.";
  if (address.street.length < 5) fields.street = "Enter the house number and street.";
  if (!address.locality) fields.locality = "Enter the locality.";
  if (!/^\d{6}$/.test(address.pin)) fields.pin = "Enter a six-digit PIN.";
  if (Object.keys(fields).length) throw new HttpError(400, "INVALID_ADDRESS", "Check the highlighted address fields.", fields);
  const result = await catalog.coverageFor(address.pin, session);
  if (!result.eligible) throw new HttpError(422, "UNAVAILABLE_PIN", result.message, { pin: result.message });
  return address;
}

export function addressService(db, catalog) {
  async function list(phone) {
    return (await db.customers.findOne({ _id: phone }))?.addresses || [];
  }
  async function put(phone, input, id, quiet = false) {
    const address = await checkedAddress(input, catalog);
    return db.transaction(async session => {
      const customer = await db.customers.findOne({ _id: phone }, { session });
      const addresses = customer?.addresses || [];
      const existing = id ? addresses.find(entry => entry.id === id) :
        addresses.find(entry => ["name", "phone", "street", "locality", "pin"].every(key => entry[key] === address[key]));
      if (id && !existing) throw new HttpError(404, "NOT_FOUND", "Address not found.");
      if (!existing && addresses.length >= 12) {
        if (quiet) return null;
        throw new HttpError(409, "ADDRESS_LIMIT", "Remove an address before adding another.");
      }
      const saved = { ...address, id: existing?.id || token(), isDefault: existing?.isDefault || !addresses.length || input.isDefault === true };
      const updated = existing ? addresses.map(entry => entry.id === saved.id ? saved : entry) : [...addresses, saved];
      if (saved.isDefault) updated.forEach(entry => { entry.isDefault = entry.id === saved.id; });
      await db.customers.updateOne({ _id: phone }, {
        $set: { addresses: updated, ...(!customer?.name && { name: address.name }) }
      }, { upsert: true, session });
      return saved;
    });
  }
  async function remove(phone, id) {
    return db.transaction(async session => {
      const customer = await db.customers.findOne({ _id: phone }, { session });
      const current = customer?.addresses.find(entry => entry.id === id);
      if (!current) throw new HttpError(404, "NOT_FOUND", "Address not found.");
      const addresses = customer.addresses.filter(entry => entry.id !== id);
      if (current.isDefault && addresses.length) addresses[0].isDefault = true;
      await db.customers.updateOne({ _id: phone }, { $set: { addresses } }, { session });
    });
  }
  return { list, put, remove };
}
