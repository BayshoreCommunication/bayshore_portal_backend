import { Service } from "../models/service.model";
import { ClientService } from "../models/clientService.model";
import { ApiError } from "./ApiError";

export type ServiceChoice = { service: string; subServices: string[] };

// Checks a list of { service, subServices } against the catalog and returns, for
// each, the catalog service and the chosen sub-services with the catalog's current
// names and prices (in catalog order). Throws before anything is written if a
// service or sub-service isn't in the catalog.
export const planFromCatalog = async (wanted: ServiceChoice[]) => {
  const serviceIds = wanted.map((entry) => entry.service);
  if (new Set(serviceIds).size !== serviceIds.length) throw new ApiError(422, "A service is listed twice");

  const catalog = new Map((await Service.find({ _id: { $in: serviceIds } })).map((service) => [String(service._id), service]));

  return wanted.map((entry) => {
    const service = catalog.get(entry.service);
    if (!service) throw new ApiError(422, "A service in the list is no longer in the catalog");

    const picked = new Set(entry.subServices);
    const subServices = service.subServices
      .filter((item) => picked.has(String(item._id)))
      .map((item) => ({ subService: item._id, name: item.name, price: item.price }));
    if (subServices.length !== picked.size) throw new ApiError(422, `A sub-service chosen for "${service.title}" is no longer part of it`);

    return { service, subServices };
  });
};

const isDuplicateKey = (error: unknown) => (error as { code?: number }).code === 11000;

// Gives a client more services, or more sub-services of ones they already take.
// It only ever adds: what the client has stays. Safe to run twice for the same
// choice (a paid order confirmed by both the webhook and the return page) — the
// second run changes nothing. Anything no longer in the catalog is skipped, since
// by now the client has paid and the rest must still go through.
export const addServicesToClient = async (clientId: unknown, choices: ServiceChoice[]) => {
  const services = await Service.find({ _id: { $in: choices.map((choice) => choice.service) } });

  for (const choice of choices) {
    const service = services.find((candidate) => String(candidate._id) === choice.service);
    if (!service) continue;

    const merge = async () => {
      const assignment = await ClientService.findOne({ client: clientId, service: service._id });
      const wanted = new Set([...(assignment?.subServices.map((item) => String(item.subService)) ?? []), ...choice.subServices]);
      // What they have plus what was chosen, in catalog order with current prices.
      const subServices = service.subServices
        .filter((item) => wanted.has(String(item._id)))
        .map((item) => ({ subService: item._id, name: item.name, price: item.price }));
      if (subServices.length === 0) return;

      if (!assignment) {
        await new ClientService({ client: clientId, service: service._id, subServices, addedBy: "client" }).save();
        return;
      }
      assignment.subServices = subServices;
      if (assignment.isModified()) await assignment.save();
    };

    try {
      await merge();
    } catch (error) {
      // Two confirmations of the same order raced to create it; the other one won,
      // so merge into what it created.
      if (!isDuplicateKey(error)) throw error;
      await merge();
    }
  }
};
