import { permanentRedirect } from "next/navigation";

/** A landing mora no endereço principal; /site continua valendo e leva para lá. */
export default function SiteRedirect() {
  permanentRedirect("/");
}
