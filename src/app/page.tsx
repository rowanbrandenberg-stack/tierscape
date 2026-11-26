import { StartJob } from "@/components/home/StartJob";
import { JobList } from "@/components/home/JobList";
import { ExampleCard } from "@/components/home/ExampleCard";
import s from "./home.module.css";

export default function Home() {
  return (
    <main className="page">
      <div className={s.top}>
        <section className={s.hero}>
          <p className="label">Landscape proposals that close</p>
          <h1 className="display">
            Turn a yard photo into three priced options and a signed deposit.
          </h1>
          <p className="lede">
            Snap the yard and note what the client asked for. Tierscape drafts
            affordable, standard and premium scopes from your own rates, with
            concept pictures. You check the numbers, send one link, and the
            client picks, signs and pays the deposit. No photo? Start from the
            address and measure on the aerial.
          </p>
          <StartJob />
        </section>
        <ExampleCard />
      </div>
      <JobList />
    </main>
  );
}
